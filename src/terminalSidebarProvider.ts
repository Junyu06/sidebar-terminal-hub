import * as vscode from 'vscode'

import {
    CONTAINER_ID,
    IMMEDIATE_FLUSH_SEQUENCE_PATTERN,
    LIVE_OUTPUT_FLUSH_DELAY_MS,
    MAX_BUFFER_LENGTH,
    SETTINGS_KEY,
    VIEW_ID
} from './terminalSidebar/constants'
import { getResolvedLanguage, getUiMessages } from './terminalSidebar/i18n'
import { getDefaultTerminalFontSize, normalizeSettings } from './terminalSidebar/settings'
import { getDefaultCwd, getShellSpec } from './terminalSidebar/shell'
import type {
    SidebarSession,
    SidebarSettings,
    SpawnSessionOptions,
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

const pty = require('node-pty')

export class TerminalSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly sessions = new Map<string, SidebarSession>()
    private view?: vscode.WebviewView
    private isReady = false
    private activeSessionId?: string
    private nextSessionNumber = 1
    private settings: SidebarSettings

    constructor(private readonly context: vscode.ExtensionContext) {
        this.settings = normalizeSettings(
            this.context.globalState.get<StoredSidebarSettings>(SETTINGS_KEY)
        )
    }

    dispose() {
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
    }

    async reveal() {
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
        this.spawnSession({ makeActive: true })
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

        view.onDidDispose(() => {
            if (this.view === view) {
                this.view = undefined
                this.isReady = false
            }
        })

        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.postHydrate()
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
                this.postHydrate()
                return
            case 'create-session':
                this.spawnSession({ makeActive: true })
                return
            case 'create-quick-session':
                this.spawnQuickSession(message.quickCommandId)
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

    private spawnQuickSession(quickCommandId: string) {
        const quickCommand = this.settings.quickCommands.find(item => item.id === quickCommandId)
        if (!quickCommand) {
            return
        }

        this.spawnSession({
            makeActive: true,
            displayName: quickCommand.label,
            initialCommand: quickCommand.command
        })
    }

    private spawnSession(options: SpawnSessionOptions) {
        const id = `session-${Date.now()}-${this.nextSessionNumber}`
        const cwd = getDefaultCwd()
        const shellSpec = getShellSpec()
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
            buffer: '',
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
                    TERM_PROGRAM: 'right-sidebar-terminal'
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

        session.ptyProcess.onExit((event: { exitCode: number }) => {
            const existing = this.sessions.get(session.id)
            if (!existing) {
                return
            }

            this.flushSessionData(existing)
            existing.status = 'exited'
            existing.exitCode = event.exitCode
            this.postMessage({
                type: 'session-exit',
                payload: {
                    sessionId: session.id,
                    exitCode: event.exitCode
                }
            })
            this.postHydrate()
        })

        this.sessions.set(id, session)

        if (options.makeActive || !this.activeSessionId) {
            this.activeSessionId = id
        }

        this.postHydrate()
    }

    private closeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return
        }

        this.flushSessionData(session)
        this.sessions.delete(sessionId)

        try {
            session.ptyProcess.kill()
        } catch {
        }

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = Array.from(this.sessions.keys())[0]
        }

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
}
