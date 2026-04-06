import * as vscode from 'vscode'

import type {
    LanguagePreference,
    ResolvedLanguage,
    UiMessages
} from './types'

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
        readyCopy: 'Create a terminal tab here and run your development commands directly inside the sidebar.',
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
        terminalPaddingHint: 'Enable 8px 6px 8px 8px padding around the terminal content. If a terminal UI renders incorrectly, slightly adjust the sidebar width and the layout will automatically recover.',
        showTerminalScrollbar: 'Show terminal scrollbar',
        showTerminalScrollbarHint: 'Show the terminal viewport scrollbar.',
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
        quickCommandLabelPlaceholder: 'Shown text, for example Test',
        quickCommandCommandPlaceholder: 'Command to run, for example codex',
        quickCommandIconPlaceholder: 'https://..., data:image/...;base64,..., or <svg>...</svg>',
        quickCommandIconHint: 'Supports image URL, Base64 data URL, or SVG code. Leave blank to use the first command letter.',
        cancel: 'Cancel',
        save: 'Save',
        resetSessionMemory: 'Session memory',
        resetSessionMemoryHint: 'Clear all saved session snapshots and close the current sidebar terminal tabs.',
        resetSessionMemoryButton: 'Reset all session memory',
        resetSessionMemoryConfirm: 'Reset all session memory? This will close current sidebar terminal tabs and remove restored session snapshots.',
        resetSessionMemorySuccess: 'Session memory cleared.',
        closeSessionTitle: 'Close {name}',
        closeSessionAria: 'Close {name}',
        renameSessionTitle: 'Rename session',
        renameSessionPrompt: 'Enter a new tab name'
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
        readyCopy: '在这里创建终端标签页，并直接在侧边栏中运行你自己的开发命令。',
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
        terminalPaddingHint: '启用后在终端四周使用 8px 6px 8px 8px 的内边距，若某些终端界面内容出现显示混乱时，可以稍微调整侧栏宽度，调整后内容会自动修复。',
        showTerminalScrollbar: '显示命令窗口滚动条',
        showTerminalScrollbarHint: '显示终端视口滚动条。',
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
        quickCommandLabelPlaceholder: '显示名称，例如 Test',
        quickCommandCommandPlaceholder: '要执行的命令，例如 codex',
        quickCommandIconPlaceholder: 'https://...、data:image/...;base64,... 或 <svg>...</svg>',
        quickCommandIconHint: '支持图片 URL、Base64 Data URL 或 SVG 代码；留空时使用命令首字母。',
        cancel: '取消',
        save: '保存',
        resetSessionMemory: '会话记忆',
        resetSessionMemoryHint: '清空所有已保存的会话快照，并关闭当前侧边栏终端标签。',
        resetSessionMemoryButton: '重置全部会话记忆',
        resetSessionMemoryConfirm: '确认重置全部会话记忆吗？这会关闭当前侧边栏终端标签，并删除后续恢复所用的会话快照。',
        resetSessionMemorySuccess: '已清空会话记忆。',
        closeSessionTitle: '关闭 {name}',
        closeSessionAria: '关闭 {name}',
        renameSessionTitle: '重命名标签',
        renameSessionPrompt: '输入新的标签名称'
    }
}

export function normalizeLanguagePreference(languagePreference?: LanguagePreference): LanguagePreference {
    if (languagePreference === 'zh-CN' || languagePreference === 'en') {
        return languagePreference
    }

    return 'system'
}

export function getResolvedLanguage(
    languagePreference: LanguagePreference = 'system'
): ResolvedLanguage {
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

    return candidates.some(candidate => isChineseLocale(candidate))
        ? 'zh-CN'
        : 'en'
}

export function getUiMessages(language: ResolvedLanguage): UiMessages {
    return UI_MESSAGES[language]
}

export function formatMessage(
    template: string,
    values: Record<string, string | number>
): string {
    return template.replace(/\{(\w+)\}/g, (_, key: string) => {
        const value = values[key]
        return value === undefined ? '' : String(value)
    })
}

export function formatTabCount(count: number, messages: UiMessages): string {
    return formatMessage(
        count === 1 ? messages.tabCountOne : messages.tabCountOther,
        { count }
    )
}

function isChineseLocale(candidate: string | undefined): boolean {
    if (!candidate) {
        return false
    }

    const normalized = candidate.trim().toLowerCase().replace(/_/g, '-')
    return normalized.startsWith('zh')
        || normalized.includes('-cn')
        || normalized.endsWith('cn')
        || normalized.includes('hans')
}
