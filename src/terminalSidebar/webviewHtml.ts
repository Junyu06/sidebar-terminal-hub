import * as vscode from 'vscode'

import { DEFAULT_QUICK_COMMANDS } from './constants'
import { formatTabCount } from './i18n'
import type {
    LanguagePreference,
    ResolvedLanguage,
    SidebarSettings,
    UiMessages
} from './types'

interface CreateSidebarHtmlOptions {
    webview: vscode.Webview
    extensionUri: vscode.Uri
    language: ResolvedLanguage
    messages: UiMessages
    settings: SidebarSettings
    defaultTerminalFontSize: number
}

export function createSidebarHtml(options: CreateSidebarHtmlOptions): string {
    const {
        webview,
        extensionUri,
        language,
        messages,
        settings,
        defaultTerminalFontSize
    } = options

    const nonce = getNonce()
    const xtermScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm', 'lib', 'xterm.js')
    )
    const fitScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm-addon-fit', 'lib', 'xterm-addon-fit.js')
    )
    const webglScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm-addon-webgl', 'lib', 'xterm-addon-webgl.js')
    )
    const xtermStyleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm', 'css', 'xterm.css')
    )
    const sidebarScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.js')
    )
    const sidebarStyleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css')
    )
    const webviewConfig = {
        defaultTerminalFontSize,
        builtinQuickCommandIcons: getBuiltinQuickCommandIconUriMap(webview, extensionUri),
        language,
        messages,
        settings
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
                <span id="tab-count" class="pill">${formatTabCount(0, messages)}</span>
            </div>
            <div class="toolbar">
                <div id="toolbar-quick-commands" class="toolbar-quick-commands"></div>
                <button id="new-session" class="icon-button" type="button" title="${messages.newSessionTitle}" aria-label="${messages.newSessionAria}">${getIconMarkup('plus')}</button>
                <button id="open-settings" class="icon-button" type="button" title="${messages.openSettingsTitle}" aria-label="${messages.openSettingsAria}">${getIconMarkup('settings')}</button>
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
                <button id="settings-close" class="icon-button" type="button" title="${messages.closeSettingsTitle}" aria-label="${messages.closeSettingsAria}">${getIconMarkup('close')}</button>
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
                                <output id="terminal-font-size-value" class="stepper-value" aria-live="polite">${settings.terminalFontSize ?? defaultTerminalFontSize}</output>
                                <button id="increase-font-size" class="stepper-button" type="button" title="${messages.increaseFontSizeTitle}" aria-label="${messages.increaseFontSizeAria}"><span aria-hidden="true">+</span></button>
                            </div>
                        </label>
                        <label class="field" for="interface-language">
                            <span id="interface-language-label" class="field-label">${messages.interfaceLanguage}</span>
                            <select id="interface-language" class="select-input">
                                ${getLanguageOptionsHtml(settings.languagePreference, messages)}
                            </select>
                        </label>
                        <div class="field">
                            <span id="terminal-padding-label" class="field-label">${messages.terminalPadding}</span>
                            <label class="toggle-row settings-switch-card" for="terminal-padding-enabled">
                                <span id="terminal-padding-hint" class="toggle-hint">${messages.terminalPaddingHint}</span>
                                <input id="terminal-padding-enabled" class="checkbox-input" type="checkbox" aria-labelledby="terminal-padding-label" aria-describedby="terminal-padding-hint"${settings.terminalPaddingEnabled ? ' checked' : ''} />
                            </label>
                        </div>
                        <div class="field">
                            <span id="show-terminal-scrollbar-label" class="field-label">${messages.showTerminalScrollbar}</span>
                            <label class="toggle-row settings-switch-card" for="show-terminal-scrollbar-enabled">
                                <span id="show-terminal-scrollbar-hint" class="toggle-hint">${messages.showTerminalScrollbarHint}</span>
                                <input id="show-terminal-scrollbar-enabled" class="checkbox-input" type="checkbox" aria-labelledby="show-terminal-scrollbar-label" aria-describedby="show-terminal-scrollbar-hint"${settings.showTerminalScrollbar ? ' checked' : ''} />
                            </label>
                        </div>
                        <div class="field">
                            <span id="reset-session-memory-label" class="field-label">${messages.resetSessionMemory}</span>
                            <div class="settings-action-card" aria-labelledby="reset-session-memory-label" aria-describedby="reset-session-memory-hint">
                                <span id="reset-session-memory-hint" class="toggle-hint">${messages.resetSessionMemoryHint}</span>
                                <button id="reset-session-memory" class="secondary-button danger-button" type="button">${messages.resetSessionMemoryButton}</button>
                            </div>
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
    <script nonce="${nonce}" src="${webglScriptUri}"></script>
    <script nonce="${nonce}" src="${sidebarScriptUri}"></script>
</body>
</html>`
}

function getBuiltinQuickCommandIconUriMap(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): Record<string, string> {
    const icons = new Map<string, string>()

    for (const command of DEFAULT_QUICK_COMMANDS) {
        icons.set(
            command.icon,
            webview.asWebviewUri(
                vscode.Uri.joinPath(
                    extensionUri,
                    'media',
                    getQuickCommandIconFileName(command.icon)
                )
            ).toString()
        )
    }

    return Object.fromEntries(icons)
}

function getQuickCommandIconFileName(icon: string): string {
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

function getIconMarkup(icon: 'plus' | 'settings' | 'close'): string {
    switch (icon) {
        case 'plus':
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
        case 'settings':
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 2.3 2.9-.2.7 2.8 2.6 1.2-1.2 2.6 1.2 2.6-2.6 1.2-.7 2.8-2.9-.2L12 21l-1.8-2.3-2.9.2-.7-2.8-2.6-1.2 1.2-2.6-1.2-2.6 2.6-1.2.7-2.8 2.9.2L12 3Z"/><circle cx="12" cy="12" r="3.2"/></svg>'
        case 'close':
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    }
}

function getLanguageOptionsHtml(
    languagePreference: LanguagePreference,
    messages: UiMessages
): string {
    const options: Array<{ value: LanguagePreference; label: string }> = [
        { value: 'system', label: messages.followSystem },
        { value: 'zh-CN', label: messages.languageChinese },
        { value: 'en', label: messages.languageEnglish }
    ]

    return options.map(option => {
        const selected = languagePreference === option.value ? ' selected' : ''
        return `<option value="${option.value}"${selected}>${option.label}</option>`
    }).join('')
}

function getNonce(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let value = ''

    for (let index = 0; index < 32; index += 1) {
        value += characters.charAt(Math.floor(Math.random() * characters.length))
    }

    return value
}
