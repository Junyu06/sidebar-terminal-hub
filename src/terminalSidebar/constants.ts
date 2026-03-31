export const VIEW_ID = 'rstTerminalSecondaryView'
export const CONTAINER_ID = 'rst-terminal-secondary-container'
export const OPEN_COMMAND = 'terminalSidebar.open'
export const NEW_SESSION_COMMAND = 'terminalSidebar.newSession'
export const CLOSE_ACTIVE_SESSION_COMMAND = 'terminalSidebar.closeActiveSession'

export const MAX_BUFFER_LENGTH = 200_000
export const SETTINGS_KEY = 'terminalSidebar.settings'
export const SESSIONS_KEY = 'terminalSidebar.sessions'
export const LIVE_OUTPUT_FLUSH_DELAY_MS = 8
export const IMMEDIATE_FLUSH_SEQUENCE_PATTERN = /\u001b\[\?(?:47|1047|1048|1049)[hl]|\u001b\[2J|\u001bc/

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 32

export const DEFAULT_QUICK_COMMANDS = [
    { id: 'codex', label: 'Codex', command: 'codex', icon: 'builtin:codex' },
    { id: 'claude', label: 'Claude', command: 'claude', icon: 'builtin:claude' },
    { id: 'gemini', label: 'Gemini', command: 'gemini', icon: 'builtin:gemini' },
    { id: 'opencode', label: 'OpenCode', command: 'opencode', icon: 'builtin:opencode' }
] as const
