export type LanguagePreference = 'system' | 'zh-CN' | 'en'
export type ResolvedLanguage = 'zh-CN' | 'en'

export interface SidebarQuickCommand {
    id: string
    label: string
    command: string
    icon: string
    visible: boolean
}

export interface StoredSidebarQuickCommand {
    id?: string
    label?: string
    command?: string
    icon?: string
    visible?: boolean
}

export interface UiMessages {
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
    showTerminalScrollbar: string
    showTerminalScrollbarHint: string
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
    renameSessionTitle: string
    renameSessionPrompt: string
}

export interface SidebarSession {
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
    pendingData: string
    flushTimer: number | undefined
    pendingInitialCommand?: string
    hasReportedSize: boolean
}

export interface StoredSidebarSession {
    id: string
    name: string
    cwd: string
    shellPath: string
    shellLabel: string
    buffer: string
}

export interface SidebarSettings {
    terminalFontSize?: number
    languagePreference: LanguagePreference
    terminalPaddingEnabled: boolean
    showTerminalScrollbar: boolean
    quickCommands: SidebarQuickCommand[]
}

export interface StoredSidebarSettings {
    terminalFontSize?: number
    languagePreference?: LanguagePreference
    terminalPaddingEnabled?: boolean
    showTerminalScrollbar?: boolean
    hideTerminalScrollbar?: boolean
    quickCommands?: StoredSidebarQuickCommand[]
    commandButtons?: Record<string, boolean>
}

export interface SpawnSessionOptions {
    makeActive: boolean
    id?: string
    displayName?: string
    cwd?: string
    shellPath?: string
    shellLabel?: string
    initialBuffer?: string
    initialCommand?: string
}

export interface ShellSpec {
    path: string
    args: string[]
    label: string
}

export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'create-session' }
    | { type: 'create-quick-session'; quickCommandId: string }
    | { type: 'request-rename-session'; sessionId: string }
    | { type: 'set-active-session'; sessionId: string }
    | { type: 'input'; sessionId: string; data: string }
    | { type: 'resize'; sessionId: string; cols: number; rows: number }
    | { type: 'close-session'; sessionId: string }
    | { type: 'rename-session'; sessionId: string; name: string }
    | { type: 'reorder-sessions'; sessionIds: string[] }
    | { type: 'update-settings'; settings: StoredSidebarSettings }
    | { type: 'request-copy'; text: string }
    | { type: 'request-paste'; sessionId: string }
