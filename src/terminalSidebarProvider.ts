import * as vscode from 'vscode'

import {
    ACTIVE_SESSION_KEY,
    CONTAINER_ID,
    IMMEDIATE_FLUSH_SEQUENCE_PATTERN,
    LIVE_OUTPUT_FLUSH_DELAY_MS,
    MAX_BUFFER_LENGTH,
    SETTINGS_KEY,
    SESSIONS_KEY,
    VIEW_ID
} from './terminalSidebar/constants'
import { getResolvedLanguage, getUiMessages } from './terminalSidebar/i18n'
import { getDefaultTerminalFontSize, normalizeSettings } from './terminalSidebar/settings'
import { getDefaultCwd, getShellSpec } from './terminalSidebar/shell'
import type {
    SidebarSession,
    StoredSidebarState,
    SidebarSettings,
    SpawnSessionOptions,
    StoredSidebarSession,
    StoredSidebarSettings,
    WebviewMessage
} from './terminalSidebar/types'
import { createSidebarHtml } from './terminalSidebar/webviewHtml'

export {
    CLOSE_ACTIVE_SESSION_COMMAND,
    CONTAINER_ID,
    NEW_SESSION_COMMAND,
    OPEN_COMMAND,
    VIEW_ID
} from './terminalSidebar/constants'

const fs = require('fs') as {
    existsSync(filePath: string): boolean
    statSync(filePath: string): { mode: number }
    chmodSync(filePath: string, mode: number): void
}
const path = require('path') as {
    join(...parts: string[]): string
}

type NodePtyModule = {
    spawn: typeof import('node-pty').spawn
}

export class TerminalSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly sessions = new Map<string, SidebarSession>()
    private readonly outputChannel = vscode.window.createOutputChannel('Sidebar Terminal Hub')
    private view?: vscode.WebviewView
    private isReady = false
    private activeSessionId?: string
    private nextSessionNumber = 1
    private settings: SidebarSettings
    private ptyModule?: NodePtyModule
    private hasRestoredSessions = false
    private isShuttingDown = false

    constructor(private readonly context: vscode.ExtensionContext) {
        this.settings = normalizeSettings(
            this.context.globalState.get<StoredSidebarSettings>(SETTINGS_KEY)
        )
        void this.updateSessionContext()
    }

    dispose() {
        this.beginShutdown()
        this.outputChannel.dispose()

        for (const session of this.sessions.values()) {
            if (session.flushTimer !== undefined) {
                clearTimeout(session.flushTimer)
            }
            try {
                session.ptyProcess.kill()
            } catch {
            }
        }

        this.sessions.clear()
        if (!this.isShuttingDown) {
            void this.updateSessionContext()
        }
    }

    async prepareForShutdown() {
        this.beginShutdown()
        await this.persistSessions()
    }

    private beginShutdown() {
        if (this.isShuttingDown) {
            return
        }

        this.isShuttingDown = true

        for (const session of this.sessions.values()) {
            this.flushSessionData(session)
        }

        void this.persistSessions()
    }

    async reveal() {
        await this.restoreSessionsIfNeeded()

        if (this.view) {
            this.view.show(false)
            return
        }

        const commands = await vscode.commands.getCommands(true)
        const revealCommands = [
            `${VIEW_ID}.focus`,
            `workbench.view.extension.${VIEW_ID}`,
            `workbench.view.extension.${CONTAINER_ID}`
        ]

        for (const command of revealCommands) {
            if (commands.includes(command)) {
                await vscode.commands.executeCommand(command)
                return
            }
        }

        if (commands.includes('workbench.action.openView')) {
            const openViewArguments: unknown[] = [
                VIEW_ID,
                { viewId: VIEW_ID },
                { id: VIEW_ID },
                CONTAINER_ID,
                { viewId: CONTAINER_ID },
                { id: CONTAINER_ID }
            ]

            for (const argument of openViewArguments) {
                try {
                    await vscode.commands.executeCommand('workbench.action.openView', argument)
                    return
                } catch {
                }
            }
        }

        void vscode.window.showErrorMessage('Unable to reveal the embedded terminal sidebar view.')
    }

    async createSession() {
        await this.reveal()
        try {
            this.spawnSession({ makeActive: true })
        } catch (error) {
            this.reportError('Failed to create terminal session.', error)
        }
    }

    closeActiveSession() {
        const sessionId = this.activeSessionId ?? Array.from(this.sessions.keys())[0]
        if (!sessionId) {
            return
        }

        this.closeSession(sessionId)
    }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view
        this.isReady = false
        void this.restoreSessionsIfNeeded()

        view.onDidDispose(() => {
            if (this.view === view) {
                this.view = undefined
                this.isReady = false
            }
        })

        view.onDidChangeVisibility(() => {
            if (view.visible) {
                void this.restoreAndHydrate()
            }
        })

        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this.context.extensionUri,
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm'),
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-fit'),
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-webgl')
            ]
        }

        view.webview.onDidReceiveMessage((message: WebviewMessage) => {
            this.handleMessage(message)
        })

        const language = getResolvedLanguage(this.settings.languagePreference)
        const messages = getUiMessages(language)

        view.webview.html = createSidebarHtml({
            webview: view.webview,
            extensionUri: this.context.extensionUri,
            language,
            messages,
            settings: this.settings,
            defaultTerminalFontSize: getDefaultTerminalFontSize()
        })
    }

    private handleMessage(message: WebviewMessage) {
        switch (message.type) {
            case 'ready':
                this.isReady = true
                void this.restoreAndHydrate()
                return
            case 'create-session':
                this.spawnSession({ makeActive: true })
                return
            case 'create-quick-session':
                this.spawnQuickSession(message.quickCommandId)
                return
            case 'request-rename-session':
                void this.promptRenameSession(message.sessionId)
                return
            case 'rename-session':
                void this.renameSession(message.sessionId, message.name)
                return
            case 'reorder-sessions':
                void this.reorderSessions(message.sessionIds)
                return
            case 'request-reset-session-memory':
                void this.resetSessionMemory()
                return
            case 'set-active-session':
                if (this.sessions.has(message.sessionId)) {
                    this.activeSessionId = message.sessionId
                    this.postHydrate()
                }
                return
            case 'input':
                this.sessions.get(message.sessionId)?.ptyProcess.write(message.data)
                return
            case 'resize': {
                const session = this.sessions.get(message.sessionId)
                if (!session) {
                    return
                }

                session.cols = message.cols
                session.rows = message.rows
                session.hasReportedSize = true

                try {
                    session.ptyProcess.resize(message.cols, message.rows)
                } catch {
                }

                this.runPendingInitialCommand(session)
                return
            }
            case 'close-session':
                this.closeSession(message.sessionId)
                return
            case 'update-settings':
                void this.updateSettings(message.settings)
                return
            case 'request-copy':
                void this.copyToClipboard(message.text)
                return
            case 'request-paste':
                void this.pasteFromClipboard(message.sessionId)
                return
        }
    }

    private async copyToClipboard(text: string) {
        if (!text) {
            return
        }

        try {
            await vscode.env.clipboard.writeText(text)
        } catch {
        }
    }

    private async pasteFromClipboard(sessionId: string) {
        if (!this.sessions.has(sessionId)) {
            return
        }

        try {
            const text = await vscode.env.clipboard.readText()
            if (!text) {
                return
            }

            this.postMessage({
                type: 'paste-clipboard-data',
                payload: {
                    sessionId,
                    text
                }
            })
        } catch {
        }
    }

    private async restoreAndHydrate() {
        await this.restoreSessionsIfNeeded()
        this.postHydrate()
    }

    private spawnQuickSession(quickCommandId: string) {
        const quickCommand = this.settings.quickCommands.find(item => item.id === quickCommandId)
        if (!quickCommand) {
            return
        }

        try {
            this.spawnSession({
                makeActive: true,
                displayName: quickCommand.label,
                initialCommand: quickCommand.command
            })
        } catch (error) {
            this.reportError(`Failed to create quick terminal session "${quickCommand.label}".`, error)
        }
    }

    private spawnSession(options: SpawnSessionOptions) {
        const id = options.id ?? `session-${Date.now()}-${this.nextSessionNumber}`
        const cwd = options.cwd ?? getDefaultCwd()
        const shellSpec = options.shellPath
            ? {
                path: options.shellPath,
                args: [] as string[],
                label: options.shellLabel ?? options.displayName ?? options.shellPath.split(/[\\/]/).pop() ?? 'shell'
            }
            : getShellSpec()
        const pty = this.getPtyModule()
        const cols = 120
        const rows = 36
        const name = options.displayName ?? shellSpec.label

        this.nextSessionNumber += 1

        const session: SidebarSession = {
            id,
            name,
            cwd,
            shellPath: shellSpec.path,
            shellLabel: shellSpec.label,
            status: 'running',
            buffer: options.initialBuffer ?? '',
            cols,
            rows,
            pendingData: '',
            flushTimer: undefined,
            pendingInitialCommand: options.initialCommand,
            hasReportedSize: false,
            ptyProcess: pty.spawn(shellSpec.path, shellSpec.args, {
                name: 'xterm-256color',
                cwd,
                cols,
                rows,
                env: Object.assign({}, process.env, {
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    TERM_PROGRAM: 'sidebar-terminal-hub'
                })
            })
        }

        session.ptyProcess.onData((data: string) => {
            session.buffer = this.appendToBuffer(session.buffer, data)
            session.pendingData += data
            if (this.shouldFlushSessionDataImmediately(data)) {
                this.flushSessionData(session)
                return
            }
            if (session.flushTimer === undefined) {
                session.flushTimer = setTimeout(() => {
                    this.flushSessionData(session)
                }, LIVE_OUTPUT_FLUSH_DELAY_MS)
            }
        })

        session.ptyProcess.onExit((_event: { exitCode: number }) => {
            if (this.isShuttingDown) {
                return
            }

            const existing = this.sessions.get(session.id)
            if (!existing) {
                return
            }

            this.removeSession(session.id)
        })

        this.sessions.set(id, session)

        if (options.makeActive || !this.activeSessionId) {
            this.activeSessionId = id
        }

        void this.updateSessionContext()
        void this.persistSessions()
        this.postHydrate()
    }

    private getPtyModule(): NodePtyModule {
        if (this.ptyModule) {
            return this.ptyModule
        }

        try {
            this.ensureNodePtyHelperExecutable()
            this.ptyModule = require('node-pty') as NodePtyModule
            return this.ptyModule
        } catch (error) {
            this.reportError('Unable to load node-pty. The embedded terminal cannot start.', error)
            throw error
        }
    }

    private reportError(message: string, error: unknown) {
        const details = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim()
            : String(error)

        this.outputChannel.appendLine(`[error] ${message}`)
        this.outputChannel.appendLine(details)
        this.outputChannel.show(true)
        void vscode.window.showErrorMessage(`${message} See "Sidebar Terminal Hub" output for details.`)
    }

    private ensureNodePtyHelperExecutable() {
        if (process.platform === 'win32') {
            return
        }

        const helperPaths = [
            path.join(this.context.extensionPath, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
            path.join(this.context.extensionPath, 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
            path.join(this.context.extensionPath, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper')
        ]

        for (const helperPath of helperPaths) {
            if (!fs.existsSync(helperPath)) {
                continue
            }

            try {
                const stats = fs.statSync(helperPath)
                const isExecutable = (stats.mode & 0o111) !== 0

                if (!isExecutable) {
                    fs.chmodSync(helperPath, 0o755)
                }
            } catch (error) {
                this.outputChannel.appendLine(`[warn] Failed to update node-pty helper permissions: ${helperPath}`)
                this.outputChannel.appendLine(String(error))
            }
        }
    }

    private updateSessionContext() {
        return vscode.commands.executeCommand(
            'setContext',
            'terminalSidebar.hasSessions',
            this.sessions.size > 0
        )
    }

    private closeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return
        }

        try {
            session.ptyProcess.kill()
        } catch {
        }

        this.removeSession(sessionId)
    }

    private removeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return
        }

        this.flushSessionData(session)
        this.sessions.delete(sessionId)

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = Array.from(this.sessions.keys())[0]
        }

        void this.updateSessionContext()
        void this.persistSessions()
        this.postHydrate()
    }

    private flushSessionData(session: SidebarSession) {
        if (session.flushTimer !== undefined) {
            clearTimeout(session.flushTimer)
            session.flushTimer = undefined
        }

        if (!session.pendingData) {
            return
        }

        const data = session.pendingData
        session.pendingData = ''
        void this.persistSessions()
        this.postMessage({
            type: 'session-data',
            payload: {
                sessionId: session.id,
                data
            }
        })
    }

    private shouldFlushSessionDataImmediately(data: string) {
        return IMMEDIATE_FLUSH_SEQUENCE_PATTERN.test(data)
    }

    private runPendingInitialCommand(session: SidebarSession) {
        if (!session.pendingInitialCommand || !session.hasReportedSize) {
            return
        }

        const command = session.pendingInitialCommand
        session.pendingInitialCommand = undefined

        try {
            session.ptyProcess.write(`${command}\r`)
        } catch {
            session.pendingInitialCommand = command
        }
    }

    private postHydrate() {
        if (!this.view || !this.isReady) {
            return
        }

        const language = getResolvedLanguage(this.settings.languagePreference)
        const messages = getUiMessages(language)

        this.postMessage({
            type: 'hydrate',
            payload: {
                activeSessionId: this.activeSessionId,
                language,
                messages,
                settings: this.settings,
                sessions: Array.from(this.sessions.values()).map(session => ({
                    id: session.id,
                    name: session.name,
                    cwd: session.cwd,
                    shellPath: session.shellPath,
                    shellLabel: session.shellLabel,
                    status: session.status,
                    exitCode: session.exitCode,
                    buffer: session.buffer
                }))
            }
        })
    }

    private postMessage(message: unknown) {
        if (!this.view || !this.isReady || !this.view.visible) {
            return
        }

        void this.view.webview.postMessage(message)
    }

    private appendToBuffer(currentBuffer: string, chunk: string) {
        const combined = currentBuffer + chunk
        if (combined.length <= MAX_BUFFER_LENGTH) {
            return combined
        }

        return combined.slice(combined.length - MAX_BUFFER_LENGTH)
    }

    private async updateSettings(settings: StoredSidebarSettings) {
        this.settings = normalizeSettings(settings)
        await this.context.globalState.update(SETTINGS_KEY, this.settings)
        this.postHydrate()
    }

    private async renameSession(sessionId: string, name: string) {
        const session = this.sessions.get(sessionId)
        const nextName = name.trim()
        if (!session || !nextName) {
            return
        }

        session.name = nextName
        await this.persistSessions()
        this.postHydrate()
    }

    private async promptRenameSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return
        }

        const language = getResolvedLanguage(this.settings.languagePreference)
        const messages = getUiMessages(language)
        const nextName = await vscode.window.showInputBox({
            title: messages.renameSessionTitle,
            prompt: messages.renameSessionPrompt,
            value: session.name,
            valueSelection: [0, session.name.length],
            ignoreFocusOut: true,
            validateInput: value => value.trim().length > 0 ? undefined : messages.renameSessionPrompt
        })

        if (typeof nextName !== 'string') {
            return
        }

        await this.renameSession(sessionId, nextName)
    }

    private async reorderSessions(sessionIds: string[]) {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return
        }

        const reordered = new Map<string, SidebarSession>()

        for (const sessionId of sessionIds) {
            const session = this.sessions.get(sessionId)
            if (session) {
                reordered.set(sessionId, session)
            }
        }

        for (const [sessionId, session] of this.sessions) {
            if (!reordered.has(sessionId)) {
                reordered.set(sessionId, session)
            }
        }

        this.sessions.clear()
        for (const [sessionId, session] of reordered) {
            this.sessions.set(sessionId, session)
        }

        await this.persistSessions()
        this.postHydrate()
    }

    private async resetSessionMemory() {
        const language = getResolvedLanguage(this.settings.languagePreference)
        const messages = getUiMessages(language)
        const confirmed = await vscode.window.showWarningMessage(
            messages.resetSessionMemoryConfirm,
            { modal: true },
            messages.resetSessionMemoryButton
        )

        if (confirmed !== messages.resetSessionMemoryButton) {
            return
        }

        const sessions = Array.from(this.sessions.values())
        this.activeSessionId = undefined

        for (const session of sessions) {
            this.flushSessionData(session)
            try {
                session.ptyProcess.kill()
            } catch {
            }
        }

        this.sessions.clear()
        await this.persistSessions()
        await this.updateSessionContext()
        this.postHydrate()
        void vscode.window.showInformationMessage(messages.resetSessionMemorySuccess)
    }

    private async restoreSessionsIfNeeded() {
        if (this.hasRestoredSessions) {
            return
        }

        this.hasRestoredSessions = true
        const storedState = this.getStoredSessionState()
        const storedSessions = storedState.sessions
        if (!Array.isArray(storedSessions) || storedSessions.length === 0) {
            return
        }

        const storedActiveSessionId = storedState.activeSessionId

        for (const storedSession of storedSessions) {
            try {
                this.spawnSession({
                    makeActive: false,
                    id: storedSession.id,
                    displayName: storedSession.name,
                    cwd: storedSession.cwd,
                    shellPath: storedSession.shellPath,
                    shellLabel: storedSession.shellLabel,
                    initialBuffer: storedSession.buffer
                })
            } catch {
            }
        }

        if (storedActiveSessionId && this.sessions.has(storedActiveSessionId)) {
            this.activeSessionId = storedActiveSessionId
            return
        }

        if (!this.activeSessionId) {
            this.activeSessionId = storedSessions[0]?.id
        }
    }

    private persistSessions() {
        const storedState: StoredSidebarState = {
            activeSessionId: this.activeSessionId,
            sessions: Array.from(this.sessions.values()).map(session => ({
            id: session.id,
            name: session.name,
            cwd: session.cwd,
            shellPath: session.shellPath,
            shellLabel: session.shellLabel,
            buffer: session.buffer
            }))
        }

        return Promise.all([
            this.context.workspaceState.update(SESSIONS_KEY, storedState.sessions),
            this.context.workspaceState.update(ACTIVE_SESSION_KEY, storedState.activeSessionId)
        ])
    }

    private getStoredSessionState(): StoredSidebarState {
        const workspaceSessions = this.context.workspaceState.get<StoredSidebarSession[]>(SESSIONS_KEY)
        const workspaceActiveSessionId = this.context.workspaceState.get<string>(ACTIVE_SESSION_KEY)

        if (Array.isArray(workspaceSessions) && workspaceSessions.length > 0) {
            return {
                activeSessionId: workspaceActiveSessionId,
                sessions: workspaceSessions
            }
        }

        const legacyGlobalSessions = this.context.globalState.get<StoredSidebarSession[]>(SESSIONS_KEY)
        const legacyGlobalActiveSessionId = this.context.globalState.get<string>(ACTIVE_SESSION_KEY)

        if (Array.isArray(legacyGlobalSessions) && legacyGlobalSessions.length > 0) {
            return {
                activeSessionId: legacyGlobalActiveSessionId,
                sessions: legacyGlobalSessions
            }
        }

        return {
            activeSessionId: workspaceActiveSessionId,
            sessions: []
        }
    }
}
