import * as vscode from 'vscode'

declare function require(moduleName: string): any

declare const process: {
    platform: string
    arch: string
    env: Record<string, string | undefined>
    cwd(): string
}

const pty = require('node-pty')

export const VIEW_ID = 'rstTerminalSecondaryView'
export const CONTAINER_ID = 'rst-terminal-secondary-container'
export const OPEN_COMMAND = 'terminalSidebar.open'
export const NEW_SESSION_COMMAND = 'terminalSidebar.newSession'
export const CLOSE_ACTIVE_SESSION_COMMAND = 'terminalSidebar.closeActiveSession'

const MAX_BUFFER_LENGTH = 200_000
const SETTINGS_KEY = 'terminalSidebar.settings'

const QUICK_COMMANDS = [
    { id: 'codex', label: 'Codex', command: 'codex' },
    { id: 'claude', label: 'Claude', command: 'claude' },
    { id: 'gemini', label: 'Gemini', command: 'gemini' },
    { id: 'opencode', label: 'OpenCode', command: 'opencode' }
] as const

type QuickCommandId = (typeof QUICK_COMMANDS)[number]['id']

interface SidebarSession {
    id: string
    name: string
    ptyProcess: any
    cwd: string
    shellPath: string
    shellLabel: string
    status: 'running' | 'exited'
    exitCode?: number
    buffer: string
    cols: number
    rows: number
}

interface SidebarSettings {
    terminalFontSize?: number
    commandButtons: Record<QuickCommandId, boolean>
}

interface StoredSidebarSettings {
    terminalFontSize?: number
    commandButtons?: Partial<Record<QuickCommandId, boolean>>
}

interface SpawnSessionOptions {
    makeActive: boolean
    displayName?: string
    initialCommand?: string
}

type WebviewMessage =
    | { type: 'ready' }
    | { type: 'create-session' }
    | { type: 'create-quick-session'; quickCommandId: QuickCommandId }
    | { type: 'set-active-session'; sessionId: string }
    | { type: 'input'; sessionId: string; data: string }
    | { type: 'resize'; sessionId: string; cols: number; rows: number }
    | { type: 'close-session'; sessionId: string }
    | { type: 'update-settings'; settings: StoredSidebarSettings }

export class TerminalSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly sessions = new Map<string, SidebarSession>()
    private view?: vscode.WebviewView
    private isReady = false
    private activeSessionId?: string
    private nextSessionNumber = 1
    private settings: SidebarSettings

    constructor(private readonly context: vscode.ExtensionContext) {
        this.settings = this.normalizeSettings(
            this.context.globalState.get<StoredSidebarSettings>(SETTINGS_KEY)
        )
    }

    dispose() {
        for (const session of this.sessions.values()) {
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
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-fit')
            ]
        }

        view.webview.onDidReceiveMessage((message: WebviewMessage) => {
            this.handleMessage(message)
        })

        view.webview.html = this.getHtml(view.webview)

        if (this.sessions.size === 0) {
            this.spawnSession({ makeActive: true })
        }
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

                try {
                    session.ptyProcess.resize(message.cols, message.rows)
                } catch {
                }
                return
            }
            case 'close-session':
                this.closeSession(message.sessionId)
                return
            case 'update-settings':
                void this.updateSettings(message.settings)
                return
        }
    }

    private spawnQuickSession(quickCommandId: QuickCommandId) {
        const quickCommand = QUICK_COMMANDS.find(item => item.id === quickCommandId)
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
        const cwd = this.getDefaultCwd()
        const shellSpec = this.getShellSpec()
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
            this.postMessage({
                type: 'session-data',
                payload: {
                    sessionId: session.id,
                    data
                }
            })
        })

        session.ptyProcess.onExit((event: { exitCode: number }) => {
            const existing = this.sessions.get(session.id)
            if (!existing) {
                return
            }

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

        if (options.initialCommand) {
            try {
                session.ptyProcess.write(`${options.initialCommand}\r`)
            } catch {
            }
        }

        this.postHydrate()
    }

    private closeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return
        }

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

    private postHydrate() {
        if (!this.view || !this.isReady) {
            return
        }

        this.postMessage({
            type: 'hydrate',
            payload: {
                activeSessionId: this.activeSessionId,
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

    private getDefaultCwd() {
        const folder = vscode.workspace.workspaceFolders?.[0]
        if (folder && folder.uri.scheme === 'file') {
            return folder.uri.fsPath
        }

        return process.cwd()
    }

    private getShellSpec() {
        if (process.platform === 'win32') {
            const integratedConfig = vscode.workspace.getConfiguration('terminal.integrated')
            const defaultProfile = integratedConfig.get<string>('defaultProfile.windows')
            const profiles = integratedConfig.get<Record<string, { path?: string | string[]; args?: string | string[] }>>('profiles.windows') ?? {}
            const configuredProfile = defaultProfile ? profiles[defaultProfile] : undefined
            const configuredPath = configuredProfile ? this.readProfilePath(configuredProfile.path) : undefined
            const configuredArgs = configuredProfile ? this.readProfileArgs(configuredProfile.args) : []

            if (configuredPath) {
                return {
                    path: configuredPath,
                    args: configuredArgs,
                    label: this.basename(configuredPath)
                }
            }

            const powershell = process.env['POWERSHELL_DISTRIBUTION_CHANNEL'] ? 'pwsh.exe' : undefined
            const fallback = powershell ?? process.env['COMSPEC'] ?? 'cmd.exe'

            return {
                path: fallback,
                args: [],
                label: this.basename(fallback)
            }
        }

        const shell = process.env['SHELL'] ?? '/bin/bash'
        return {
            path: shell,
            args: [],
            label: this.basename(shell)
        }
    }

    private readProfilePath(value: string | string[] | undefined) {
        if (!value) {
            return undefined
        }

        if (Array.isArray(value)) {
            return value[0]
        }

        return value
    }

    private readProfileArgs(value: string | string[] | undefined) {
        if (!value) {
            return []
        }

        if (Array.isArray(value)) {
            return value
        }

        return [value]
    }

    private basename(filePath: string) {
        const segments = filePath.split(/[\\/]/)
        return segments[segments.length - 1].replace(/\.exe$/i, '')
    }

    private normalizeSettings(settings?: StoredSidebarSettings): SidebarSettings {
        const commandButtons = this.getDefaultCommandButtons()

        for (const command of QUICK_COMMANDS) {
            commandButtons[command.id] = settings?.commandButtons?.[command.id] ?? true
        }

        return {
            terminalFontSize: this.normalizeFontSize(settings?.terminalFontSize),
            commandButtons
        }
    }

    private normalizeFontSize(fontSize: number | undefined) {
        if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) {
            return undefined
        }

        return Math.max(10, Math.min(32, Math.round(fontSize)))
    }

    private async updateSettings(settings: StoredSidebarSettings) {
        this.settings = this.normalizeSettings(settings)
        await this.context.globalState.update(SETTINGS_KEY, this.settings)
        this.postHydrate()
    }

    private getDefaultTerminalFontSize() {
        const terminalFontSize = vscode.workspace.getConfiguration('terminal.integrated').get<number>('fontSize')
        if (typeof terminalFontSize === 'number' && Number.isFinite(terminalFontSize) && terminalFontSize > 0) {
            return terminalFontSize
        }

        const editorFontSize = vscode.workspace.getConfiguration('editor').get<number>('fontSize')
        if (typeof editorFontSize === 'number' && Number.isFinite(editorFontSize) && editorFontSize > 0) {
            return editorFontSize
        }

        return 13
    }

    private getDefaultCommandButtons(): Record<QuickCommandId, boolean> {
        const commandButtons = {} as Record<QuickCommandId, boolean>

        for (const command of QUICK_COMMANDS) {
            commandButtons[command.id] = true
        }

        return commandButtons
    }

    private getToolbarButtonsHtml(webview: vscode.Webview) {
        return QUICK_COMMANDS.map(command => {
            const hiddenClass = this.settings.commandButtons[command.id] ? '' : ' hidden'
            const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', this.getQuickCommandIconFileName(command.id)))
            return `<button id="launch-${command.id}" class="icon-button quick-command-button${hiddenClass}" type="button" data-quick-command-id="${command.id}" title="Open ${command.label} terminal" aria-label="Open ${command.label} terminal"><img class="quick-command-icon" src="${iconUri}" alt="" /></button>`
        }).join('')
    }

    private getSettingsRowsHtml() {
        return QUICK_COMMANDS.map(command => {
            const checked = this.settings.commandButtons[command.id] ? ' checked' : ''
            return `<label class="toggle-row" for="toggle-${command.id}"><span class="toggle-copy">${command.label}</span><input id="toggle-${command.id}" class="checkbox-input" type="checkbox" data-toggle-command-id="${command.id}"${checked} /></label>`
        }).join('')
    }

    private getQuickCommandIconFileName(commandId: QuickCommandId) {
        switch (commandId) {
            case 'codex':
                return 'codex.svg'
            case 'claude':
                return 'claude.svg'
            case 'gemini':
                return 'gemini.svg'
            case 'opencode':
                return 'opencode.ico'
        }
    }

    private getIconMarkup(icon: 'plus' | 'settings' | 'close') {
        switch (icon) {
            case 'plus':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
            case 'settings':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 2.3 2.9-.2.7 2.8 2.6 1.2-1.2 2.6 1.2 2.6-2.6 1.2-.7 2.8-2.9-.2L12 21l-1.8-2.3-2.9.2-.7-2.8-2.6-1.2 1.2-2.6-1.2-2.6 2.6-1.2.7-2.8 2.9.2L12 3Z"/><circle cx="12" cy="12" r="3.2"/></svg>'
            case 'close':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
        }
    }

    private getHtml(webview: vscode.Webview) {
        const nonce = this.getNonce()
        const xtermScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm', 'lib', 'xterm.js'))
        const fitScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-fit', 'lib', 'xterm-addon-fit.js'))
        const xtermStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm', 'css', 'xterm.css'))
        const sidebarScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'))
        const sidebarStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'))
        const webviewConfig = {
            defaultTerminalFontSize: this.getDefaultTerminalFontSize(),
            quickCommands: QUICK_COMMANDS.map(({ id, label }) => ({ id, label })),
            settings: this.settings
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Embedded Terminal</title>
    <link rel="stylesheet" href="${xtermStyleUri}" />
    <link rel="stylesheet" href="${sidebarStyleUri}" />
</head>
<body>
    <div class="layout">
        <div class="titlebar">
            <div class="title-group">
                <span class="title">Embedded Terminal</span>
                <span id="tab-count" class="pill">0 tabs</span>
            </div>
            <div class="toolbar">
                ${this.getToolbarButtonsHtml(webview)}
                <button id="new-session" class="icon-button" type="button" title="New terminal tab" aria-label="New terminal tab">${this.getIconMarkup('plus')}</button>
                <button id="open-settings" class="icon-button" type="button" title="Open terminal settings" aria-label="Open terminal settings">${this.getIconMarkup('settings')}</button>
            </div>
        </div>
        <div id="tabs" class="tabs"></div>
        <div class="stage">
            <div id="empty-state" class="empty-state hidden">
                <div class="empty-card">
                    <div class="empty-title">Ready to run commands</div>
                    <div class="empty-copy">Create a terminal tab here and run tools like Codex, Claude, Gemini, or OpenCode directly inside the sidebar.</div>
                    <button id="create-first-session" class="primary-button" type="button">Create terminal</button>
                </div>
            </div>
            <div id="viewport" class="viewport"></div>
        </div>
    </div>
    <div id="settings-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-card">
            <div class="modal-header">
                <div>
                    <div id="settings-title" class="modal-title">Terminal Settings</div>
                    <div class="modal-subtitle">Customize the embedded terminal experience.</div>
                </div>
                <button id="settings-close" class="icon-button" type="button" title="Close settings" aria-label="Close settings">${this.getIconMarkup('close')}</button>
            </div>
            <div class="modal-body">
                <label class="field" for="terminal-font-size">
                    <span class="field-label">Terminal font size</span>
                    <input id="terminal-font-size" class="number-input" type="number" min="10" max="32" step="1" value="${this.settings.terminalFontSize ?? this.getDefaultTerminalFontSize()}" />
                </label>
                <div class="settings-group">
                    <div class="settings-group-title">Command buttons</div>
                    ${this.getSettingsRowsHtml()}
                </div>
            </div>
            <div class="modal-actions">
                <button id="settings-cancel" class="secondary-button" type="button">Cancel</button>
                <button id="settings-save" class="primary-button" type="button">Save</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">window.__RST_CONFIG__ = ${JSON.stringify(webviewConfig)}</script>
    <script nonce="${nonce}" src="${xtermScriptUri}"></script>
    <script nonce="${nonce}" src="${fitScriptUri}"></script>
    <script nonce="${nonce}" src="${sidebarScriptUri}"></script>
</body>
</html>`
    }

    private getNonce() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        let value = ''

        for (let index = 0; index < 32; index += 1) {
            value += characters.charAt(Math.floor(Math.random() * characters.length))
        }

        return value
    }
}
