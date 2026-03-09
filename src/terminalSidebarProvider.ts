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

const DEFAULT_QUICK_COMMANDS = [
    { id: 'codex', label: 'Codex', command: 'codex', icon: 'builtin:codex' },
    { id: 'claude', label: 'Claude', command: 'claude', icon: 'builtin:claude' },
    { id: 'gemini', label: 'Gemini', command: 'gemini', icon: 'builtin:gemini' },
    { id: 'opencode', label: 'OpenCode', command: 'opencode', icon: 'builtin:opencode' }
] as const

type LanguagePreference = 'system' | 'zh-CN' | 'en'
type ResolvedLanguage = 'zh-CN' | 'en'

interface SidebarQuickCommand {
    id: string
    label: string
    command: string
    icon: string
    visible: boolean
}

interface StoredSidebarQuickCommand {
    id?: string
    label?: string
    command?: string
    icon?: string
    visible?: boolean
}

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
    appearanceSettingsTab: string
    commandSettingsTab: string
    closeSettingsTitle: string
    closeSettingsAria: string
    terminalFontSize: string
    decreaseFontSizeTitle: string
    decreaseFontSizeAria: string
    increaseFontSizeTitle: string
    increaseFontSizeAria: string
    interfaceLanguage: string
    terminalPadding: string
    terminalPaddingHint: string
    followSystem: string
    languageChinese: string
    languageEnglish: string
    commandButtons: string
    addQuickCommand: string
    removeQuickCommandTitle: string
    quickCommandShowTitle: string
    quickCommandHideTitle: string
    quickCommandEmpty: string
    quickCommandLabel: string
    quickCommandCommand: string
    quickCommandIcon: string
    quickCommandVisible: string
    quickCommandLabelPlaceholder: string
    quickCommandCommandPlaceholder: string
    quickCommandIconPlaceholder: string
    quickCommandIconHint: string
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
        appearanceSettingsTab: 'Interface',
        commandSettingsTab: 'Buttons',
        closeSettingsTitle: 'Close settings',
        closeSettingsAria: 'Close settings',
        terminalFontSize: 'Terminal font size',
        decreaseFontSizeTitle: 'Decrease font size',
        decreaseFontSizeAria: 'Decrease font size',
        increaseFontSizeTitle: 'Increase font size',
        increaseFontSizeAria: 'Increase font size',
        interfaceLanguage: 'Interface language',
        terminalPadding: 'Terminal padding',
        terminalPaddingHint: 'Enable 8px 6px 8px 8px padding around the terminal content. If CLI windows such as Claude Code, OpenCode, or Gemini render incorrectly, slightly adjust the sidebar width and the layout will automatically recover.',
        followSystem: 'Follow system',
        languageChinese: '中文',
        languageEnglish: 'English',
        commandButtons: 'Quick buttons',
        addQuickCommand: 'Add button',
        removeQuickCommandTitle: 'Remove quick button',
        quickCommandShowTitle: 'Show quick button',
        quickCommandHideTitle: 'Hide quick button',
        quickCommandEmpty: 'No quick buttons yet.',
        quickCommandLabel: 'Label',
        quickCommandCommand: 'Command',
        quickCommandIcon: 'Icon',
        quickCommandVisible: 'Show',
        quickCommandLabelPlaceholder: 'Shown text, for example Codex',
        quickCommandCommandPlaceholder: 'Command to run, for example codex',
        quickCommandIconPlaceholder: 'https://..., data:image/...;base64,..., or <svg>...</svg>',
        quickCommandIconHint: 'Supports image URL, Base64 data URL, or SVG code. Leave blank to use the first command letter.',
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
        appearanceSettingsTab: '界面设置',
        commandSettingsTab: '按钮设置',
        closeSettingsTitle: '关闭设置',
        closeSettingsAria: '关闭设置',
        terminalFontSize: '终端字体大小',
        decreaseFontSizeTitle: '减小字体大小',
        decreaseFontSizeAria: '减小字体大小',
        increaseFontSizeTitle: '增大字体大小',
        increaseFontSizeAria: '增大字体大小',
        interfaceLanguage: '界面语言（Interface language）',
        terminalPadding: '终端内边距',
        terminalPaddingHint: '启用后在终端四周使用 8px 6px 8px 8px 的内边距，若 Claude Code、OpenCode、Gemini 等 CLI 窗口内容出现显示混乱时，可以稍微调整侧栏宽度，调整后内容会自动修复。',
        followSystem: '跟随系统',
        languageChinese: '中文',
        languageEnglish: 'English',
        commandButtons: '快捷按钮',
        addQuickCommand: '添加按钮',
        removeQuickCommandTitle: '删除快捷按钮',
        quickCommandShowTitle: '显示快捷按钮',
        quickCommandHideTitle: '隐藏快捷按钮',
        quickCommandEmpty: '还没有快捷按钮。',
        quickCommandLabel: '名称',
        quickCommandCommand: '命令',
        quickCommandIcon: '图标',
        quickCommandVisible: '显示',
        quickCommandLabelPlaceholder: '显示名称，例如 Codex',
        quickCommandCommandPlaceholder: '要执行的命令，例如 codex',
        quickCommandIconPlaceholder: 'https://...、data:image/...;base64,... 或 <svg>...</svg>',
        quickCommandIconHint: '支持图片 URL、Base64 Data URL 或 SVG 代码；留空时使用命令首字母。',
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
    terminalPaddingEnabled: boolean
    quickCommands: SidebarQuickCommand[]
}

interface StoredSidebarSettings {
    terminalFontSize?: number
    languagePreference?: LanguagePreference
    terminalPaddingEnabled?: boolean
    quickCommands?: StoredSidebarQuickCommand[]
    commandButtons?: Record<string, boolean>
}

interface SpawnSessionOptions {
    makeActive: boolean
    displayName?: string
    initialCommand?: string
}

type WebviewMessage =
    | { type: 'ready' }
    | { type: 'create-session' }
    | { type: 'create-quick-session'; quickCommandId: string }
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
        return {
            terminalFontSize: this.normalizeFontSize(settings?.terminalFontSize),
            languagePreference: this.normalizeLanguagePreference(settings?.languagePreference),
            terminalPaddingEnabled: this.normalizeTerminalPaddingEnabled(settings?.terminalPaddingEnabled),
            quickCommands: this.normalizeQuickCommands(settings?.quickCommands, settings?.commandButtons)
        }
    }

    private normalizeTerminalPaddingEnabled(value: boolean | undefined) {
        return value === true
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

    private normalizeQuickCommands(
        commands: StoredSidebarQuickCommand[] | undefined,
        legacyCommandButtons: Record<string, boolean> | undefined
    ) {
        const defaults = this.getDefaultQuickCommands(legacyCommandButtons)

        if (!Array.isArray(commands)) {
            return defaults
        }

        const defaultMap = new Map(defaults.map(command => [command.id, command]))
        const usedIds = new Set<string>()
        const normalized: SidebarQuickCommand[] = []

        for (const [index, command] of commands.entries()) {
            const defaultCommand = typeof command?.id === 'string'
                ? defaultMap.get(command.id.trim())
                : undefined
            const nextCommand = this.normalizeQuickCommand(command, index, defaultCommand, usedIds)
            if (nextCommand) {
                normalized.push(nextCommand)
            }
        }

        return normalized
    }

    private normalizeQuickCommand(
        command: StoredSidebarQuickCommand | undefined,
        index: number,
        defaultCommand: SidebarQuickCommand | undefined,
        usedIds: Set<string>
    ) {
        const rawCommand = typeof command?.command === 'string'
            ? command.command.trim()
            : defaultCommand?.command ?? ''

        if (!rawCommand) {
            return undefined
        }

        const label = this.normalizeQuickCommandLabel(command?.label, rawCommand, defaultCommand?.label, index)
        const preferredId = typeof command?.id === 'string' && command.id.trim().length > 0
            ? command.id.trim()
            : defaultCommand?.id ?? `quick-command-${index + 1}`

        return {
            id: this.makeUniqueQuickCommandId(preferredId, usedIds),
            label,
            command: rawCommand,
            icon: this.normalizeQuickCommandIcon(command?.icon, defaultCommand?.icon ?? ''),
            visible: typeof command?.visible === 'boolean'
                ? command.visible
                : defaultCommand?.visible ?? true
        }
    }

    private getDefaultQuickCommands(legacyCommandButtons: Record<string, boolean> | undefined): SidebarQuickCommand[] {
        return DEFAULT_QUICK_COMMANDS.map(command => ({
            id: command.id,
            label: command.label,
            command: command.command,
            icon: command.icon,
            visible: legacyCommandButtons?.[command.id] ?? true
        }))
    }

    private normalizeQuickCommandLabel(
        label: string | undefined,
        command: string,
        fallbackLabel: string | undefined,
        index: number
    ) {
        const nextLabel = typeof label === 'string' ? label.trim() : ''
        if (nextLabel) {
            return nextLabel
        }

        if (fallbackLabel && fallbackLabel.trim()) {
            return fallbackLabel.trim()
        }

        return command || `Command ${index + 1}`
    }

    private normalizeQuickCommandIcon(icon: string | undefined, fallbackIcon: string) {
        if (typeof icon === 'string') {
            return this.sanitizeQuickCommandIcon(icon)
        }

        return this.sanitizeQuickCommandIcon(fallbackIcon)
    }

    private sanitizeQuickCommandIcon(icon: string) {
        const value = icon.trim()

        if (!value) {
            return ''
        }

        if (/^data:image\/[^;]+;base64,/i.test(value)) {
            return value.replace(/\s+/g, '')
        }

        if (/^data:image\//i.test(value)) {
            return value
        }

        if (/^<svg[\s>]/i.test(value)) {
            return this.normalizeInlineSvgMarkup(value)
        }

        return value
    }

    private normalizeInlineSvgMarkup(svgMarkup: string) {
        const value = svgMarkup.trim()
        const openingTagMatch = value.match(/^<svg\b[^>]*>/i)

        if (!openingTagMatch) {
            return value
        }

        if (/\sxmlns\s*=\s*['"][^'"]+['"]/i.test(openingTagMatch[0])) {
            return value
        }

        return value.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    private makeUniqueQuickCommandId(preferredId: string, usedIds: Set<string>) {
        let nextId = preferredId
        let suffix = 2

        while (usedIds.has(nextId)) {
            nextId = `${preferredId}-${suffix}`
            suffix += 1
        }

        usedIds.add(nextId)
        return nextId
    }

    private getBuiltinQuickCommandIconUriMap(webview: vscode.Webview) {
        const icons = new Map<string, string>()

        for (const command of DEFAULT_QUICK_COMMANDS) {
            icons.set(
                command.icon,
                webview.asWebviewUri(
                    vscode.Uri.joinPath(
                        this.context.extensionUri,
                        'media',
                        this.getQuickCommandIconFileName(command.icon)
                    )
                ).toString()
            )
        }

        return Object.fromEntries(icons)
    }

    private getQuickCommandIconFileName(icon: string) {
        switch (icon) {
            case 'builtin:codex':
                return 'codex.svg'
            case 'builtin:claude':
                return 'claude.svg'
            case 'builtin:gemini':
                return 'gemini.svg'
            case 'builtin:opencode':
                return 'opencode.ico'
            default:
                return 'icon.svg'
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
            builtinQuickCommandIcons: this.getBuiltinQuickCommandIconUriMap(webview),
            language,
            messages,
            settings: this.settings
        }

        return `<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: http: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';" />
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
                <div id="toolbar-quick-commands" class="toolbar-quick-commands"></div>
                <button id="new-session" class="icon-button" type="button" title="${messages.newSessionTitle}" aria-label="${messages.newSessionAria}">${this.getIconMarkup('plus')}</button>
                <button id="open-settings" class="icon-button" type="button" title="${messages.openSettingsTitle}" aria-label="${messages.openSettingsAria}">${this.getIconMarkup('settings')}</button>
            </div>
        </div>
        <div id="terminal-content" class="terminal-content">
            <div id="tabs" class="tabs"></div>
            <div class="stage">
                <div id="empty-state" class="empty-state hidden">
                    <div class="empty-card">
                        <div id="empty-title" class="empty-title">${messages.readyTitle}</div>
                        <div id="empty-copy" class="empty-copy">${messages.readyCopy}</div>
                        <div class="empty-actions">
                            <button id="create-first-session" class="primary-button" type="button">${messages.createTerminal}</button>
                            <div id="quick-launch-group" class="quick-launch-group">
                                <div id="quick-launch-label" class="quick-launch-label">${messages.quickLaunch}</div>
                                <div id="quick-launch-buttons" class="quick-launch-grid"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="viewport" class="viewport"></div>
            </div>
        </div>
        <div id="settings-page" class="settings-page hidden" aria-labelledby="settings-title">
        <div class="settings-shell">
            <div class="settings-page-header">
                <div>
                    <div id="settings-title" class="modal-title">${messages.settingsTitle}</div>
                    <div id="settings-subtitle" class="modal-subtitle">${messages.settingsSubtitle}</div>
                </div>
                <button id="settings-close" class="icon-button" type="button" title="${messages.closeSettingsTitle}" aria-label="${messages.closeSettingsAria}">${this.getIconMarkup('close')}</button>
            </div>
            <div class="settings-tabs" role="tablist" aria-label="${messages.settingsTitle}">
                <button id="settings-tab-appearance" class="settings-tab active" type="button" role="tab" aria-selected="true" aria-controls="settings-panel-appearance" data-settings-tab="appearance">${messages.appearanceSettingsTab}</button>
                <button id="settings-tab-commands" class="settings-tab" type="button" role="tab" aria-selected="false" aria-controls="settings-panel-commands" data-settings-tab="commands">${messages.commandSettingsTab}</button>
            </div>
            <div class="settings-page-body">
                <div id="settings-panel-appearance" class="settings-panel active" role="tabpanel" aria-labelledby="settings-tab-appearance" data-settings-panel="appearance">
                    <div class="settings-card">
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
                        <div class="field">
                            <span id="terminal-padding-label" class="field-label">${messages.terminalPadding}</span>
                            <label class="toggle-row settings-switch-card" for="terminal-padding-enabled">
                                <span id="terminal-padding-hint" class="toggle-hint">${messages.terminalPaddingHint}</span>
                                <input id="terminal-padding-enabled" class="checkbox-input" type="checkbox" aria-labelledby="terminal-padding-label" aria-describedby="terminal-padding-hint"${this.settings.terminalPaddingEnabled ? ' checked' : ''} />
                            </label>
                        </div>
                    </div>
                </div>
                <div id="settings-panel-commands" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-commands" data-settings-panel="commands" hidden>
                    <div class="settings-group settings-card">
                        <div class="settings-group-header">
                            <div id="command-buttons-title" class="settings-group-title">${messages.commandButtons}</div>
                            <button id="add-quick-command" class="secondary-button add-quick-command-button" type="button">${messages.addQuickCommand}</button>
                        </div>
                        <div id="quick-command-list" class="quick-command-list"></div>
                    </div>
                </div>
            </div>
            <div class="settings-page-actions">
                <button id="settings-cancel" class="secondary-button" type="button">${messages.cancel}</button>
                <button id="settings-save" class="primary-button" type="button">${messages.save}</button>
            </div>
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
