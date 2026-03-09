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
type LanguagePreference = 'system' | 'zh-CN' | 'en'
type ResolvedLanguage = 'zh-CN' | 'en'

interface UiMessages {
    documentTitle: string
    viewTitle: string
    tabCountOne: string
    tabCountOther: string
    newSessionTitle: string
    newSessionAria: string
    openSettingsTitle: string
    openSettingsAria: string
    openQuickTerminalTitle: string
    openQuickTerminalAria: string
    readyTitle: string
    readyCopy: string
    createTerminal: string
    quickLaunch: string
    settingsTitle: string
    settingsSubtitle: string
    closeSettingsTitle: string
    closeSettingsAria: string
    terminalFontSize: string
    decreaseFontSizeTitle: string
    decreaseFontSizeAria: string
    increaseFontSizeTitle: string
    increaseFontSizeAria: string
    interfaceLanguage: string
    followSystem: string
    languageChinese: string
    languageEnglish: string
    commandButtons: string
    cancel: string
    save: string
    closeSessionTitle: string
    closeSessionAria: string
}

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 32

const UI_MESSAGES: Record<ResolvedLanguage, UiMessages> = {
    en: {
        documentTitle: 'Embedded Terminal',
        viewTitle: 'Terminal Control',
        tabCountOne: '{count} tab',
        tabCountOther: '{count} tabs',
        newSessionTitle: 'New terminal tab',
        newSessionAria: 'New terminal tab',
        openSettingsTitle: 'Open terminal settings',
        openSettingsAria: 'Open terminal settings',
        openQuickTerminalTitle: 'Open {label} terminal',
        openQuickTerminalAria: 'Open {label} terminal',
        readyTitle: 'Ready to run commands',
        readyCopy: 'Create a terminal tab here and run tools like Codex, Claude, Gemini, or OpenCode directly inside the sidebar.',
        createTerminal: 'Create terminal',
        quickLaunch: 'Quick launch',
        settingsTitle: 'Terminal Settings',
        settingsSubtitle: 'Customize the embedded terminal experience.',
        closeSettingsTitle: 'Close settings',
        closeSettingsAria: 'Close settings',
        terminalFontSize: 'Terminal font size',
        decreaseFontSizeTitle: 'Decrease font size',
        decreaseFontSizeAria: 'Decrease font size',
        increaseFontSizeTitle: 'Increase font size',
        increaseFontSizeAria: 'Increase font size',
        interfaceLanguage: 'Interface language',
        followSystem: 'Follow system',
        languageChinese: '中文',
        languageEnglish: 'English',
        commandButtons: 'Command buttons',
        cancel: 'Cancel',
        save: 'Save',
        closeSessionTitle: 'Close {name}',
        closeSessionAria: 'Close {name}'
    },
    'zh-CN': {
        documentTitle: '嵌入式终端',
        viewTitle: '终端控制',
        tabCountOne: '{count} 个标签',
        tabCountOther: '{count} 个标签',
        newSessionTitle: '新建终端标签',
        newSessionAria: '新建终端标签',
        openSettingsTitle: '打开终端设置',
        openSettingsAria: '打开终端设置',
        openQuickTerminalTitle: '打开 {label} 终端',
        openQuickTerminalAria: '打开 {label} 终端',
        readyTitle: '准备运行命令',
        readyCopy: '在这里创建终端标签页，并直接在侧边栏中运行 Codex、Claude、Gemini 或 OpenCode。',
        createTerminal: '创建终端',
        quickLaunch: '快捷启动',
        settingsTitle: '终端设置',
        settingsSubtitle: '自定义侧边栏终端体验。',
        closeSettingsTitle: '关闭设置',
        closeSettingsAria: '关闭设置',
        terminalFontSize: '终端字体大小',
        decreaseFontSizeTitle: '减小字体大小',
        decreaseFontSizeAria: '减小字体大小',
        increaseFontSizeTitle: '增大字体大小',
        increaseFontSizeAria: '增大字体大小',
        interfaceLanguage: '界面语言',
        followSystem: '跟随系统',
        languageChinese: '中文',
        languageEnglish: 'English',
        commandButtons: '命令按钮',
        cancel: '取消',
        save: '保存',
        closeSessionTitle: '关闭 {name}',
        closeSessionAria: '关闭 {name}'
    }
}

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
    languagePreference: LanguagePreference
    commandButtons: Record<QuickCommandId, boolean>
}

interface StoredSidebarSettings {
    terminalFontSize?: number
    languagePreference?: LanguagePreference
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
    | { type: 'request-copy'; text: string }
    | { type: 'request-paste'; sessionId: string }

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
                language: this.getResolvedLanguage(),
                messages: this.getUiMessages(),
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

    private normalizeLanguagePreference(languagePreference?: LanguagePreference): LanguagePreference {
        if (languagePreference === 'zh-CN' || languagePreference === 'en') {
            return languagePreference
        }

        return 'system'
    }

    private getResolvedLanguage(languagePreference = this.settings.languagePreference): ResolvedLanguage {
        if (languagePreference === 'zh-CN' || languagePreference === 'en') {
            return languagePreference
        }

        const candidates: Array<string | undefined> = [
            Intl.DateTimeFormat().resolvedOptions().locale,
            vscode.env.language,
            process.env.LANG,
            process.env.LC_ALL,
            process.env.LC_MESSAGES
        ]

        const vscodeNlsConfig = process.env.VSCODE_NLS_CONFIG
        if (vscodeNlsConfig) {
            try {
                const parsed = JSON.parse(vscodeNlsConfig) as { locale?: string }
                candidates.unshift(parsed.locale)
            } catch {
            }
        }

        return candidates.some(candidate => this.isChineseLocale(candidate))
            ? 'zh-CN'
            : 'en'
    }

    private isChineseLocale(candidate: string | undefined) {
        if (!candidate) {
            return false
        }

        const normalized = candidate.trim().toLowerCase().replace(/_/g, '-')
        return normalized.startsWith('zh')
            || normalized.includes('-cn')
            || normalized.endsWith('cn')
            || normalized.includes('hans')
    }

    private getUiMessages(language = this.getResolvedLanguage()) {
        return UI_MESSAGES[language]
    }

    private formatMessage(template: string, values: Record<string, string | number>) {
        return template.replace(/\{(\w+)\}/g, (_, key: string) => {
            const value = values[key]
            return value === undefined ? '' : String(value)
        })
    }

    private formatTabCount(count: number, messages: UiMessages) {
        return this.formatMessage(count === 1 ? messages.tabCountOne : messages.tabCountOther, { count })
    }

    private normalizeSettings(settings?: StoredSidebarSettings): SidebarSettings {
        const commandButtons = this.getDefaultCommandButtons()

        for (const command of QUICK_COMMANDS) {
            commandButtons[command.id] = settings?.commandButtons?.[command.id] ?? true
        }

        return {
            terminalFontSize: this.normalizeFontSize(settings?.terminalFontSize),
            languagePreference: this.normalizeLanguagePreference(settings?.languagePreference),
            commandButtons
        }
    }

    private normalizeFontSize(fontSize: number | undefined) {
        if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) {
            return undefined
        }

        return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(fontSize)))
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

    private getToolbarButtonsHtml(webview: vscode.Webview, messages: UiMessages) {
        return QUICK_COMMANDS.map(command => {
            const hiddenClass = this.settings.commandButtons[command.id] ? '' : ' hidden'
            const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', this.getQuickCommandIconFileName(command.id)))
            const title = this.formatMessage(messages.openQuickTerminalTitle, { label: command.label })
            const ariaLabel = this.formatMessage(messages.openQuickTerminalAria, { label: command.label })
            return `<button id="launch-${command.id}" class="icon-button quick-command-button${hiddenClass}" type="button" data-quick-command-id="${command.id}" title="${title}" aria-label="${ariaLabel}"><img class="quick-command-icon" src="${iconUri}" alt="" /></button>`
        }).join('')
    }

    private getWelcomeQuickButtonsHtml(webview: vscode.Webview, messages: UiMessages) {
        return QUICK_COMMANDS.map(command => {
            const hiddenClass = this.settings.commandButtons[command.id] ? '' : ' hidden'
            const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', this.getQuickCommandIconFileName(command.id)))
            const title = this.formatMessage(messages.openQuickTerminalTitle, { label: command.label })
            const ariaLabel = this.formatMessage(messages.openQuickTerminalAria, { label: command.label })

            return `<button class="secondary-button welcome-quick-button${hiddenClass}" type="button" data-quick-command-id="${command.id}" title="${title}" aria-label="${ariaLabel}"><img class="quick-command-icon welcome-quick-icon" src="${iconUri}" alt="" /><span class="welcome-quick-copy">${command.label}</span></button>`
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

    private getLanguageOptionsHtml(messages: UiMessages) {
        const options: Array<{ value: LanguagePreference; label: string }> = [
            { value: 'system', label: messages.followSystem },
            { value: 'zh-CN', label: messages.languageChinese },
            { value: 'en', label: messages.languageEnglish }
        ]

        return options.map(option => {
            const selected = this.settings.languagePreference === option.value ? ' selected' : ''
            return `<option value="${option.value}"${selected}>${option.label}</option>`
        }).join('')
    }

    private getHtml(webview: vscode.Webview) {
        const nonce = this.getNonce()
        const language = this.getResolvedLanguage()
        const messages = this.getUiMessages(language)
        const xtermScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm', 'lib', 'xterm.js'))
        const fitScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-fit', 'lib', 'xterm-addon-fit.js'))
        const xtermStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm', 'css', 'xterm.css'))
        const sidebarScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'))
        const sidebarStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'))
        const webviewConfig = {
            defaultTerminalFontSize: this.getDefaultTerminalFontSize(),
            language,
            messages,
            quickCommands: QUICK_COMMANDS.map(({ id, label }) => ({ id, label })),
            settings: this.settings
        }

        return `<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${messages.documentTitle}</title>
    <link rel="stylesheet" href="${xtermStyleUri}" />
    <link rel="stylesheet" href="${sidebarStyleUri}" />
</head>
<body>
    <div class="layout">
        <div class="titlebar">
            <div class="title-group">
                <span id="view-title" class="title">${messages.viewTitle}</span>
                <span id="tab-count" class="pill">${this.formatTabCount(0, messages)}</span>
            </div>
            <div class="toolbar">
                ${this.getToolbarButtonsHtml(webview, messages)}
                <button id="new-session" class="icon-button" type="button" title="${messages.newSessionTitle}" aria-label="${messages.newSessionAria}">${this.getIconMarkup('plus')}</button>
                <button id="open-settings" class="icon-button" type="button" title="${messages.openSettingsTitle}" aria-label="${messages.openSettingsAria}">${this.getIconMarkup('settings')}</button>
            </div>
        </div>
        <div id="tabs" class="tabs"></div>
        <div class="stage">
            <div id="empty-state" class="empty-state hidden">
                <div class="empty-card">
                    <div id="empty-title" class="empty-title">${messages.readyTitle}</div>
                    <div id="empty-copy" class="empty-copy">${messages.readyCopy}</div>
                    <div class="empty-actions">
                        <button id="create-first-session" class="primary-button" type="button">${messages.createTerminal}</button>
                        <div class="quick-launch-group">
                            <div id="quick-launch-label" class="quick-launch-label">${messages.quickLaunch}</div>
                            <div class="quick-launch-grid">
                                ${this.getWelcomeQuickButtonsHtml(webview, messages)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="viewport" class="viewport"></div>
        </div>
    </div>
    <div id="settings-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-card">
            <div class="modal-header">
                <div>
                    <div id="settings-title" class="modal-title">${messages.settingsTitle}</div>
                    <div id="settings-subtitle" class="modal-subtitle">${messages.settingsSubtitle}</div>
                </div>
                <button id="settings-close" class="icon-button" type="button" title="${messages.closeSettingsTitle}" aria-label="${messages.closeSettingsAria}">${this.getIconMarkup('close')}</button>
            </div>
            <div class="modal-body">
                <label class="field">
                    <span id="terminal-font-size-label" class="field-label">${messages.terminalFontSize}</span>
                    <div class="stepper" role="group" aria-labelledby="terminal-font-size-label">
                        <button id="decrease-font-size" class="stepper-button" type="button" title="${messages.decreaseFontSizeTitle}" aria-label="${messages.decreaseFontSizeAria}"><span aria-hidden="true">−</span></button>
                        <output id="terminal-font-size-value" class="stepper-value" aria-live="polite">${this.settings.terminalFontSize ?? this.getDefaultTerminalFontSize()}</output>
                        <button id="increase-font-size" class="stepper-button" type="button" title="${messages.increaseFontSizeTitle}" aria-label="${messages.increaseFontSizeAria}"><span aria-hidden="true">+</span></button>
                    </div>
                </label>
                <label class="field" for="interface-language">
                    <span id="interface-language-label" class="field-label">${messages.interfaceLanguage}</span>
                    <select id="interface-language" class="select-input">
                        ${this.getLanguageOptionsHtml(messages)}
                    </select>
                </label>
                <div class="settings-group">
                    <div id="command-buttons-title" class="settings-group-title">${messages.commandButtons}</div>
                    ${this.getSettingsRowsHtml()}
                </div>
            </div>
            <div class="modal-actions">
                <button id="settings-cancel" class="secondary-button" type="button">${messages.cancel}</button>
                <button id="settings-save" class="primary-button" type="button">${messages.save}</button>
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
