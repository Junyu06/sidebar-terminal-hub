(function () {
    const FONT_SIZE_MIN = 10
    const FONT_SIZE_MAX = 32

    const vscode = acquireVsCodeApi()
    const config = window.__RST_CONFIG__ || {}

    const fallbackMessages = {
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
        interfaceLanguage: 'Interface language (界面语言)',
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
    }

    const builtinQuickCommandIcons = config.builtinQuickCommandIcons || {}
    const defaultTerminalFontSize = Number.isFinite(config.defaultTerminalFontSize)
        ? config.defaultTerminalFontSize
        : 13

    const layoutElement = document.querySelector('.layout')
    const terminalContentElement = document.getElementById('terminal-content')
    const tabsElement = document.getElementById('tabs')
    const viewportElement = document.getElementById('viewport')
    const emptyStateElement = document.getElementById('empty-state')
    const tabCountElement = document.getElementById('tab-count')
    const viewTitleElement = document.getElementById('view-title')
    const newSessionButton = document.getElementById('new-session')
    const createFirstSessionButton = document.getElementById('create-first-session')
    const settingsButton = document.getElementById('open-settings')
    const emptyTitleElement = document.getElementById('empty-title')
    const emptyCopyElement = document.getElementById('empty-copy')
    const quickLaunchGroupElement = document.getElementById('quick-launch-group')
    const quickLaunchLabelElement = document.getElementById('quick-launch-label')
    const toolbarQuickCommandsElement = document.getElementById('toolbar-quick-commands')
    const quickLaunchButtonsElement = document.getElementById('quick-launch-buttons')
    const settingsPage = document.getElementById('settings-page')
    const settingsTitleElement = document.getElementById('settings-title')
    const settingsSubtitleElement = document.getElementById('settings-subtitle')
    const settingsTabButtons = Array.from(document.querySelectorAll('[data-settings-tab]'))
    const settingsPanels = Array.from(document.querySelectorAll('[data-settings-panel]'))
    const settingsCloseButton = document.getElementById('settings-close')
    const settingsCancelButton = document.getElementById('settings-cancel')
    const settingsSaveButton = document.getElementById('settings-save')
    const terminalFontSizeLabelElement = document.getElementById('terminal-font-size-label')
    const terminalFontSizeValueElement = document.getElementById('terminal-font-size-value')
    const decreaseFontSizeButton = document.getElementById('decrease-font-size')
    const increaseFontSizeButton = document.getElementById('increase-font-size')
    const interfaceLanguageLabelElement = document.getElementById('interface-language-label')
    const interfaceLanguageSelect = document.getElementById('interface-language')
    const terminalPaddingLabelElement = document.getElementById('terminal-padding-label')
    const terminalPaddingHintElement = document.getElementById('terminal-padding-hint')
    const terminalPaddingCheckbox = document.getElementById('terminal-padding-enabled')
    const commandButtonsTitleElement = document.getElementById('command-buttons-title')
    const addQuickCommandButton = document.getElementById('add-quick-command')
    const quickCommandListElement = document.getElementById('quick-command-list')

    const sessionModels = new Map()
    let orderedSessions = []
    let activeSessionId = undefined
    let currentLanguage = config.language === 'zh-CN' ? 'zh-CN' : 'en'
    let messages = normalizeMessages(config.messages)
    let currentSettings = normalizeSettings(config.settings)
    let draftTerminalFontSize = getTerminalFontSize()
    let activeSettingsTab = 'appearance'
    let isSettingsPageOpen = false
    let nextDraftQuickCommandNumber = 1

    const resizeObserver = new ResizeObserver(() => {
        fitActiveSession()
    })

    resizeObserver.observe(viewportElement)

    function postMessage(type, extra) {
        vscode.postMessage(Object.assign({ type }, extra || {}))
    }

    function clampFontSize(value) {
        if (!Number.isFinite(value)) {
            return undefined
        }

        return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(value)))
    }

    function normalizeLanguagePreference(value) {
        return value === 'zh-CN' || value === 'en'
            ? value
            : 'system'
    }

    function normalizeQuickCommand(value, index) {
        const input = value && typeof value === 'object' ? value : {}
        const command = typeof input.command === 'string' ? input.command.trim() : ''
        const label = typeof input.label === 'string' && input.label.trim()
            ? input.label.trim()
            : command || `Command ${index + 1}`

        return {
            id: typeof input.id === 'string' && input.id.trim()
                ? input.id.trim()
                : createDraftQuickCommandId(),
            label,
            command,
            icon: normalizeQuickCommandIconValue(input.icon),
            visible: input.visible !== false
        }
    }

    function normalizeQuickCommands(value) {
        if (!Array.isArray(value)) {
            return []
        }

        const seenIds = new Set()
        const commands = []

        for (const [index, item] of value.entries()) {
            const command = normalizeQuickCommand(item, index)
            if (!command.command) {
                continue
            }

            let nextId = command.id
            let suffix = 2

            while (seenIds.has(nextId)) {
                nextId = `${command.id}-${suffix}`
                suffix += 1
            }

            seenIds.add(nextId)
            commands.push(Object.assign({}, command, { id: nextId }))
        }

        return commands
    }

    function normalizeSettings(value) {
        return {
            terminalFontSize: clampFontSize(value && value.terminalFontSize),
            languagePreference: normalizeLanguagePreference(value && value.languagePreference),
            terminalPaddingEnabled: value && value.terminalPaddingEnabled === true,
            quickCommands: normalizeQuickCommands(value && value.quickCommands)
        }
    }

    function normalizeMessages(value) {
        return Object.assign({}, fallbackMessages, value || {})
    }

    function formatMessage(template, values) {
        return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
            const value = values && values[key]
            return value === undefined ? '' : String(value)
        })
    }

    function formatTabCount(count) {
        return formatMessage(count === 1 ? messages.tabCountOne : messages.tabCountOther, { count })
    }

    function setActiveSettingsTab(tabName, options) {
        activeSettingsTab = tabName === 'commands' ? 'commands' : 'appearance'

        for (const button of settingsTabButtons) {
            const isActive = button.getAttribute('data-settings-tab') === activeSettingsTab
            button.classList.toggle('active', isActive)
            button.setAttribute('aria-selected', isActive ? 'true' : 'false')
            button.tabIndex = isActive ? 0 : -1
        }

        for (const panel of settingsPanels) {
            const isActive = panel.getAttribute('data-settings-panel') === activeSettingsTab
            panel.classList.toggle('active', isActive)
            panel.hidden = !isActive
        }

        if (options && options.focusTab) {
            const activeButton = settingsTabButtons.find(button => button.getAttribute('data-settings-tab') === activeSettingsTab)
            activeButton && activeButton.focus()
        }
    }

    function setSettingsPageOpen(isOpen) {
        isSettingsPageOpen = isOpen === true

        if (layoutElement) {
            layoutElement.classList.toggle('settings-open', isSettingsPageOpen)
        }

        if (terminalContentElement) {
            terminalContentElement.classList.toggle('hidden', isSettingsPageOpen)
        }

        if (settingsPage) {
            settingsPage.classList.toggle('hidden', !isSettingsPageOpen)
        }
    }

    function createDraftQuickCommandId() {
        const nextId = `quick-command-${Date.now()}-${nextDraftQuickCommandNumber}`
        nextDraftQuickCommandNumber += 1
        return nextId
    }

    function getQuickCommands() {
        return Array.isArray(currentSettings.quickCommands) ? currentSettings.quickCommands : []
    }

    function getVisibleQuickCommands() {
        return getQuickCommands().filter(command => command.visible)
    }

    function normalizeInlineSvgMarkup(svgMarkup) {
        const value = typeof svgMarkup === 'string' ? svgMarkup.trim() : ''
        const openingTagMatch = value.match(/^<svg\b[^>]*>/i)

        if (!openingTagMatch) {
            return value
        }

        if (/\sxmlns\s*=\s*['"][^'"]+['"]/i.test(openingTagMatch[0])) {
            return value
        }

        return value.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    function normalizeQuickCommandIconValue(icon) {
        const value = typeof icon === 'string' ? icon.trim() : ''
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
            return normalizeInlineSvgMarkup(value)
        }

        return value
    }

    function resolveQuickCommandIconSource(icon) {
        const value = normalizeQuickCommandIconValue(icon)
        if (!value) {
            return ''
        }

        if (value.startsWith('builtin:')) {
            return builtinQuickCommandIcons[value] || ''
        }

        if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) {
            return value
        }

        if (/^<svg[\s>]/i.test(value)) {
            return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(normalizeInlineSvgMarkup(value))}`
        }

        return value
    }

    function getQuickCommandFallbackText(command) {
        const content = String(command && command.command || command && command.label || '').trim()
        return content ? content.charAt(0).toUpperCase() : '?'
    }

    function createQuickCommandIconNode(command, className) {
        const iconSource = resolveQuickCommandIconSource(command && command.icon)
        if (iconSource) {
            const icon = document.createElement('img')
            icon.className = className || 'quick-command-icon'
            icon.src = iconSource
            icon.alt = ''
            return icon
        }

        const fallback = document.createElement('span')
        fallback.className = className
            ? `quick-command-fallback ${className}`
            : 'quick-command-fallback'
        fallback.textContent = getQuickCommandFallbackText(command)
        fallback.setAttribute('aria-hidden', 'true')
        return fallback
    }

    function updateFontSizeStepperState() {
        terminalFontSizeValueElement.textContent = String(draftTerminalFontSize)
        decreaseFontSizeButton.disabled = draftTerminalFontSize <= FONT_SIZE_MIN
        increaseFontSizeButton.disabled = draftTerminalFontSize >= FONT_SIZE_MAX
    }

    function setDraftTerminalFontSize(nextValue) {
        draftTerminalFontSize = clampFontSize(nextValue) || defaultTerminalFontSize
        updateFontSizeStepperState()
    }

    function getTheme() {
        const styles = getComputedStyle(document.documentElement)
        return {
            background: styles.getPropertyValue('--vscode-terminal-background').trim() || styles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e',
            foreground: styles.getPropertyValue('--vscode-terminal-foreground').trim() || styles.getPropertyValue('--vscode-editor-foreground').trim() || '#cccccc',
            cursor: styles.getPropertyValue('--vscode-terminalCursor-foreground').trim() || styles.getPropertyValue('--vscode-foreground').trim() || '#ffffff',
            cursorAccent: styles.getPropertyValue('--vscode-terminalCursor-background').trim() || '#000000',
            selectionBackground: styles.getPropertyValue('--vscode-terminal-selectionBackground').trim() || 'rgba(128, 128, 128, 0.35)',
            black: styles.getPropertyValue('--vscode-terminal-ansiBlack').trim() || '#000000',
            red: styles.getPropertyValue('--vscode-terminal-ansiRed').trim() || '#cd3131',
            green: styles.getPropertyValue('--vscode-terminal-ansiGreen').trim() || '#0dbc79',
            yellow: styles.getPropertyValue('--vscode-terminal-ansiYellow').trim() || '#e5e510',
            blue: styles.getPropertyValue('--vscode-terminal-ansiBlue').trim() || '#2472c8',
            magenta: styles.getPropertyValue('--vscode-terminal-ansiMagenta').trim() || '#bc3fbc',
            cyan: styles.getPropertyValue('--vscode-terminal-ansiCyan').trim() || '#11a8cd',
            white: styles.getPropertyValue('--vscode-terminal-ansiWhite').trim() || '#e5e5e5',
            brightBlack: styles.getPropertyValue('--vscode-terminal-ansiBrightBlack').trim() || '#666666',
            brightRed: styles.getPropertyValue('--vscode-terminal-ansiBrightRed').trim() || '#f14c4c',
            brightGreen: styles.getPropertyValue('--vscode-terminal-ansiBrightGreen').trim() || '#23d18b',
            brightYellow: styles.getPropertyValue('--vscode-terminal-ansiBrightYellow').trim() || '#f5f543',
            brightBlue: styles.getPropertyValue('--vscode-terminal-ansiBrightBlue').trim() || '#3b8eea',
            brightMagenta: styles.getPropertyValue('--vscode-terminal-ansiBrightMagenta').trim() || '#d670d6',
            brightCyan: styles.getPropertyValue('--vscode-terminal-ansiBrightCyan').trim() || '#29b8db',
            brightWhite: styles.getPropertyValue('--vscode-terminal-ansiBrightWhite').trim() || '#ffffff'
        }
    }

    function getFontFamily() {
        const styles = getComputedStyle(document.documentElement)
        return styles.getPropertyValue('--vscode-editor-font-family').trim() || styles.getPropertyValue('--vscode-font-family').trim() || 'Consolas, monospace'
    }

    function getTerminalFontSize() {
        return currentSettings.terminalFontSize || defaultTerminalFontSize
    }

    function isCopyKeybinding(event) {
        const key = String(event.key || '').toLowerCase()
        const hasPrimaryModifier = (event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.metaKey)
        return hasPrimaryModifier && !event.altKey && key === 'c'
    }

    function createSessionModel(session) {
        const host = document.createElement('div')
        host.className = 'terminal-host hidden'
        host.dataset.sessionId = session.id
        viewportElement.appendChild(host)

        const terminal = new window.Terminal({
            cursorBlink: true,
            convertEol: false,
            allowTransparency: true,
            fontFamily: getFontFamily(),
            fontSize: getTerminalFontSize(),
            scrollback: 5000,
            theme: getTheme()
        })

        const fitAddon = new window.FitAddon.FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(host)

        terminal.attachCustomKeyEventHandler(event => {
            if (!isCopyKeybinding(event) || !terminal.hasSelection()) {
                return true
            }

            const text = terminal.getSelection()
            if (!text) {
                return true
            }

            event.preventDefault()
            event.stopPropagation()
            postMessage('request-copy', { text })
            return false
        })

        host.addEventListener('contextmenu', event => {
            event.preventDefault()
            event.stopPropagation()
            terminal.focus()
            postMessage('request-paste', { sessionId: session.id })
        }, true)

        terminal.onData(data => {
            postMessage('input', {
                sessionId: session.id,
                data
            })
        })

        terminal.onResize(size => {
            postMessage('resize', {
                sessionId: session.id,
                cols: size.cols,
                rows: size.rows
            })
        })

        if (session.buffer) {
            terminal.write(session.buffer)
        }

        const model = {
            sessionId: session.id,
            host,
            terminal,
            fitAddon,
            renderedLength: session.buffer.length,
            status: session.status
        }

        sessionModels.set(session.id, model)
        return model
    }

    function disposeSessionModel(sessionId) {
        const model = sessionModels.get(sessionId)
        if (!model) {
            return
        }

        sessionModels.delete(sessionId)
        model.terminal.dispose()
        model.host.remove()
    }

    function replaceSessionModel(session) {
        disposeSessionModel(session.id)
        return createSessionModel(session)
    }

    function syncSessionBuffer(model, session) {
        if (session.buffer.length < model.renderedLength) {
            model = replaceSessionModel(session)
            return model
        }

        const missingOutput = session.buffer.slice(model.renderedLength)
        if (missingOutput) {
            model.terminal.write(missingOutput)
            model.renderedLength = session.buffer.length
        }

        model.status = session.status
        return model
    }

    function fitActiveSession() {
        if (!activeSessionId) {
            return
        }

        const model = sessionModels.get(activeSessionId)
        if (!model || model.host.classList.contains('hidden')) {
            return
        }

        requestAnimationFrame(() => {
            model.fitAddon.fit()
            model.terminal.focus()
        })
    }

    function refreshTerminalAppearance() {
        for (const session of orderedSessions) {
            const model = sessionModels.get(session.id)
            if (!model) {
                continue
            }

            model.terminal.options.theme = getTheme()
            model.terminal.options.fontFamily = getFontFamily()
            model.terminal.options.fontSize = getTerminalFontSize()
        }

        if (orderedSessions.length > 0) {
            fitActiveSession()
        }
    }

    function openQuickCommand(commandId) {
        if (!commandId) {
            return
        }

        postMessage('create-quick-session', { quickCommandId: commandId })
    }

    function createQuickCommandButton(command) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'icon-button quick-command-button'
        button.title = formatMessage(messages.openQuickTerminalTitle, { label: command.label })
        button.setAttribute('aria-label', formatMessage(messages.openQuickTerminalAria, { label: command.label }))
        button.appendChild(createQuickCommandIconNode(command, 'quick-command-icon'))
        button.addEventListener('click', () => {
            openQuickCommand(command.id)
        })
        return button
    }

    function createWelcomeQuickCommandButton(command) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'secondary-button welcome-quick-button'
        button.title = formatMessage(messages.openQuickTerminalTitle, { label: command.label })
        button.setAttribute('aria-label', formatMessage(messages.openQuickTerminalAria, { label: command.label }))
        button.appendChild(createQuickCommandIconNode(command, 'quick-command-icon welcome-quick-icon'))

        const copy = document.createElement('span')
        copy.className = 'welcome-quick-copy'
        copy.textContent = command.label
        button.appendChild(copy)

        button.addEventListener('click', () => {
            openQuickCommand(command.id)
        })

        return button
    }

    function renderQuickCommandButtons() {
        const visibleQuickCommands = getVisibleQuickCommands()

        if (toolbarQuickCommandsElement) {
            toolbarQuickCommandsElement.replaceChildren()
            for (const command of visibleQuickCommands) {
                toolbarQuickCommandsElement.appendChild(createQuickCommandButton(command))
            }
        }

        if (quickLaunchButtonsElement) {
            quickLaunchButtonsElement.replaceChildren()
            for (const command of visibleQuickCommands) {
                quickLaunchButtonsElement.appendChild(createWelcomeQuickCommandButton(command))
            }
        }

        if (quickLaunchGroupElement) {
            quickLaunchGroupElement.classList.toggle('hidden', visibleQuickCommands.length === 0)
        }
    }

    function getQuickCommandEditorValue(editor, field) {
        const input = editor && editor.querySelector(`[data-quick-command-field="${field}"]`)
        return input ? String(input.value || '') : ''
    }

    function updateQuickCommandEditorPreview(editor) {
        if (!editor) {
            return
        }

        const preview = editor.querySelector('[data-quick-command-preview]')
        if (!preview) {
            return
        }

        const previewCommand = {
            command: getQuickCommandEditorValue(editor, 'command'),
            label: getQuickCommandEditorValue(editor, 'label'),
            icon: getQuickCommandEditorValue(editor, 'icon')
        }

        preview.replaceChildren(createQuickCommandIconNode(previewCommand, 'quick-command-preview-icon'))
    }

    function createQuickCommandField(labelText, field, value, placeholder, isTextarea) {
        const wrapper = document.createElement('label')
        wrapper.className = `field quick-command-field quick-command-field-${field}`

        const label = document.createElement('span')
        label.className = 'field-label'
        label.textContent = labelText
        wrapper.appendChild(label)

        const input = isTextarea
            ? document.createElement('textarea')
            : document.createElement('input')
        input.className = isTextarea ? 'textarea-input quick-command-input' : 'text-input quick-command-input'
        input.value = value
        input.placeholder = placeholder
        input.setAttribute('data-quick-command-field', field)

        if (!isTextarea) {
            input.type = 'text'
        } else {
            input.rows = 3
        }

        if (field === 'command' || field === 'label' || field === 'icon') {
            input.addEventListener('input', event => {
                if (field === 'command' && typeof event.currentTarget.setCustomValidity === 'function') {
                    event.currentTarget.setCustomValidity('')
                }
                updateQuickCommandEditorPreview(event.currentTarget.closest('.quick-command-editor'))
            })
        }

        wrapper.appendChild(input)

        if (field === 'icon') {
            const hint = document.createElement('span')
            hint.className = 'field-hint'
            hint.textContent = messages.quickCommandIconHint
            wrapper.appendChild(hint)
        }

        return wrapper
    }

    function createIconNode(paths) {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        icon.setAttribute('viewBox', '0 0 24 24')
        icon.setAttribute('aria-hidden', 'true')

        for (const pathDefinition of paths) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('d', pathDefinition)
            icon.appendChild(path)
        }

        return icon
    }

    function createQuickCommandVisibilityIcon(isVisible) {
        return isVisible
            ? createIconNode([
                'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z',
                'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z'
            ])
            : createIconNode([
                'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z',
                'M4 4l16 16'
            ])
    }

    function updateQuickCommandVisibilityButton(button, input) {
        const isVisible = Boolean(input && input.checked)
        const label = isVisible ? messages.quickCommandHideTitle : messages.quickCommandShowTitle

        button.replaceChildren(createQuickCommandVisibilityIcon(isVisible))
        button.title = label
        button.setAttribute('aria-label', label)
        button.setAttribute('aria-pressed', isVisible ? 'true' : 'false')
        button.classList.toggle('is-hidden', !isVisible)
    }

    function createQuickCommandEditor(command) {
        const editor = document.createElement('div')
        editor.className = 'quick-command-editor'
        editor.dataset.quickCommandId = command.id

        const header = document.createElement('div')
        header.className = 'quick-command-editor-header'

        const preview = document.createElement('div')
        preview.className = 'quick-command-preview'
        preview.setAttribute('data-quick-command-preview', '')
        preview.appendChild(createQuickCommandIconNode(command, 'quick-command-preview-icon'))
        header.appendChild(preview)

        const controls = document.createElement('div')
        controls.className = 'quick-command-editor-controls'

        const visibilityInput = document.createElement('input')
        visibilityInput.type = 'checkbox'
        visibilityInput.checked = command.visible
        visibilityInput.hidden = true
        visibilityInput.setAttribute('data-quick-command-field', 'visible')
        controls.appendChild(visibilityInput)

        const visibilityButton = document.createElement('button')
        visibilityButton.type = 'button'
        visibilityButton.className = 'icon-button quick-command-visibility'
        visibilityButton.addEventListener('click', () => {
            visibilityInput.checked = !visibilityInput.checked
            updateQuickCommandVisibilityButton(visibilityButton, visibilityInput)
        })
        updateQuickCommandVisibilityButton(visibilityButton, visibilityInput)
        controls.appendChild(visibilityButton)

        const removeButton = document.createElement('button')
        removeButton.type = 'button'
        removeButton.className = 'icon-button quick-command-remove'
        removeButton.title = messages.removeQuickCommandTitle
        removeButton.setAttribute('aria-label', messages.removeQuickCommandTitle)
        removeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
        removeButton.addEventListener('click', () => {
            editor.remove()
            updateQuickCommandEmptyState()
        })
        controls.appendChild(removeButton)

        header.appendChild(controls)
        editor.appendChild(header)

        const fields = document.createElement('div')
        fields.className = 'quick-command-fields'
        fields.appendChild(createQuickCommandField(messages.quickCommandLabel, 'label', command.label, messages.quickCommandLabelPlaceholder, false))
        fields.appendChild(createQuickCommandField(messages.quickCommandCommand, 'command', command.command, messages.quickCommandCommandPlaceholder, false))
        fields.appendChild(createQuickCommandField(messages.quickCommandIcon, 'icon', command.icon, messages.quickCommandIconPlaceholder, true))
        editor.appendChild(fields)

        return editor
    }

    function updateQuickCommandEmptyState() {
        if (!quickCommandListElement) {
            return
        }

        const editors = quickCommandListElement.querySelectorAll('.quick-command-editor')
        const emptyState = quickCommandListElement.querySelector('.quick-command-empty')

        if (editors.length === 0) {
            if (!emptyState) {
                const empty = document.createElement('div')
                empty.className = 'quick-command-empty'
                empty.textContent = messages.quickCommandEmpty
                quickCommandListElement.appendChild(empty)
            }
            return
        }

        if (emptyState) {
            emptyState.remove()
        }
    }

    function renderQuickCommandEditors(commands) {
        if (!quickCommandListElement) {
            return
        }

        quickCommandListElement.replaceChildren()

        for (const command of commands) {
            quickCommandListElement.appendChild(createQuickCommandEditor(command))
        }

        updateQuickCommandEmptyState()
    }

    function appendQuickCommandEditor(command) {
        if (!quickCommandListElement) {
            return
        }

        const emptyState = quickCommandListElement.querySelector('.quick-command-empty')
        if (emptyState) {
            emptyState.remove()
        }

        const editor = createQuickCommandEditor(command)
        quickCommandListElement.appendChild(editor)
        const labelInput = editor.querySelector('[data-quick-command-field="label"]')
        labelInput && labelInput.focus()
    }

    function applySettings(nextSettings) {
        currentSettings = normalizeSettings(nextSettings)

        document.documentElement.style.setProperty(
            '--rst-terminal-padding',
            currentSettings.terminalPaddingEnabled ? '8px 6px 8px 8px' : '0px'
        )

        renderQuickCommandButtons()

        refreshTerminalAppearance()
    }

    function applyTranslations(nextMessages, nextLanguage) {
        currentLanguage = nextLanguage === 'zh-CN' ? 'zh-CN' : 'en'
        messages = normalizeMessages(nextMessages)

        document.documentElement.lang = currentLanguage
        document.title = messages.documentTitle

        if (viewTitleElement) {
            viewTitleElement.textContent = messages.viewTitle
        }

        if (tabCountElement) {
            tabCountElement.textContent = formatTabCount(orderedSessions.length)
        }

        newSessionButton.title = messages.newSessionTitle
        newSessionButton.setAttribute('aria-label', messages.newSessionAria)
        settingsButton.title = messages.openSettingsTitle
        settingsButton.setAttribute('aria-label', messages.openSettingsAria)

        if (emptyTitleElement) {
            emptyTitleElement.textContent = messages.readyTitle
        }

        if (emptyCopyElement) {
            emptyCopyElement.textContent = messages.readyCopy
        }

        createFirstSessionButton.textContent = messages.createTerminal

        if (quickLaunchLabelElement) {
            quickLaunchLabelElement.textContent = messages.quickLaunch
        }

        if (settingsTitleElement) {
            settingsTitleElement.textContent = messages.settingsTitle
        }

        if (settingsSubtitleElement) {
            settingsSubtitleElement.textContent = messages.settingsSubtitle
        }

        for (const button of settingsTabButtons) {
            const tabName = button.getAttribute('data-settings-tab')
            button.textContent = tabName === 'commands'
                ? messages.commandSettingsTab
                : messages.appearanceSettingsTab
        }

        settingsCloseButton.title = messages.closeSettingsTitle
        settingsCloseButton.setAttribute('aria-label', messages.closeSettingsAria)

        if (terminalFontSizeLabelElement) {
            terminalFontSizeLabelElement.textContent = messages.terminalFontSize
        }

        decreaseFontSizeButton.title = messages.decreaseFontSizeTitle
        decreaseFontSizeButton.setAttribute('aria-label', messages.decreaseFontSizeAria)
        increaseFontSizeButton.title = messages.increaseFontSizeTitle
        increaseFontSizeButton.setAttribute('aria-label', messages.increaseFontSizeAria)

        if (interfaceLanguageLabelElement) {
            interfaceLanguageLabelElement.textContent = messages.interfaceLanguage
        }

        if (terminalPaddingLabelElement) {
            terminalPaddingLabelElement.textContent = messages.terminalPadding
        }

        if (terminalPaddingHintElement) {
            terminalPaddingHintElement.textContent = messages.terminalPaddingHint
        }

        if (interfaceLanguageSelect) {
            const systemOption = interfaceLanguageSelect.querySelector('option[value="system"]')
            const chineseOption = interfaceLanguageSelect.querySelector('option[value="zh-CN"]')
            const englishOption = interfaceLanguageSelect.querySelector('option[value="en"]')

            if (systemOption) {
                systemOption.textContent = messages.followSystem
            }

            if (chineseOption) {
                chineseOption.textContent = messages.languageChinese
            }

            if (englishOption) {
                englishOption.textContent = messages.languageEnglish
            }
        }

        if (commandButtonsTitleElement) {
            commandButtonsTitleElement.textContent = messages.commandButtons
        }

        if (addQuickCommandButton) {
            addQuickCommandButton.textContent = messages.addQuickCommand
        }

        settingsCancelButton.textContent = messages.cancel
        settingsSaveButton.textContent = messages.save

        renderQuickCommandButtons()
    }

    function switchActiveSession(sessionId, notifyExtension) {
        if (!sessionId || !orderedSessions.some(session => session.id === sessionId)) {
            return
        }

        activeSessionId = sessionId
        renderTabs()
        renderViewport()

        if (notifyExtension) {
            postMessage('set-active-session', { sessionId })
        }
    }

    function createCloseIcon() {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        icon.setAttribute('viewBox', '0 0 24 24')
        icon.setAttribute('aria-hidden', 'true')

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', 'M6 6l12 12M18 6L6 18')
        icon.appendChild(path)

        return icon
    }

    function renderTabs() {
        tabsElement.replaceChildren()
        tabsElement.classList.toggle('tabs-empty', orderedSessions.length === 0)

        if (tabCountElement) {
            tabCountElement.textContent = formatTabCount(orderedSessions.length)
        }

        for (const session of orderedSessions) {
            const tab = document.createElement('div')
            tab.className = session.id === activeSessionId ? 'tab active' : 'tab'
            if (session.status === 'exited') {
                tab.classList.add('exited')
            }

            const trigger = document.createElement('button')
            trigger.type = 'button'
            trigger.className = 'tab-trigger'
            trigger.title = `${session.name}\n${session.shellPath}\n${session.cwd}`
            trigger.addEventListener('click', () => {
                switchActiveSession(session.id, true)
            })

            const dot = document.createElement('span')
            dot.className = session.status === 'exited' ? 'tab-dot exited' : 'tab-dot'
            trigger.appendChild(dot)

            const title = document.createElement('span')
            title.className = 'tab-title'
            title.textContent = session.name
            trigger.appendChild(title)

            const closeButton = document.createElement('button')
            closeButton.type = 'button'
            closeButton.className = 'tab-close'
            closeButton.title = formatMessage(messages.closeSessionTitle, { name: session.name })
            closeButton.setAttribute('aria-label', formatMessage(messages.closeSessionAria, { name: session.name }))
            closeButton.appendChild(createCloseIcon())
            closeButton.addEventListener('click', event => {
                event.stopPropagation()
                postMessage('close-session', { sessionId: session.id })
            })

            tab.appendChild(trigger)
            tab.appendChild(closeButton)
            tabsElement.appendChild(tab)
        }
    }

    function renderViewport() {
        const hasSessions = orderedSessions.length > 0
        emptyStateElement.classList.toggle('hidden', hasSessions)
        viewportElement.classList.toggle('hidden', !hasSessions)

        for (const session of orderedSessions) {
            const model = sessionModels.get(session.id)
            if (!model) {
                continue
            }

            model.host.classList.toggle('hidden', session.id !== activeSessionId)
        }

        refreshTerminalAppearance()
    }

    function syncState(payload) {
        const sessions = Array.isArray(payload.sessions) ? payload.sessions : []
        const incomingIds = new Set(sessions.map(session => session.id))

        for (const existingId of Array.from(sessionModels.keys())) {
            if (!incomingIds.has(existingId)) {
                disposeSessionModel(existingId)
            }
        }

        orderedSessions = sessions
        applyTranslations(payload.messages || messages, payload.language || currentLanguage)
        applySettings(payload.settings || currentSettings)

        for (const session of sessions) {
            let model = sessionModels.get(session.id)
            if (!model) {
                model = createSessionModel(session)
            } else {
                model = syncSessionBuffer(model, session)
            }
        }

        const nextActiveSessionId = payload.activeSessionId || sessions[0] && sessions[0].id
        if (!nextActiveSessionId) {
            activeSessionId = undefined
        } else if (nextActiveSessionId !== activeSessionId) {
            activeSessionId = nextActiveSessionId
        }

        renderTabs()
        renderViewport()
    }

    function handleLiveOutput(payload) {
        const session = orderedSessions.find(item => item.id === payload.sessionId)
        const model = sessionModels.get(payload.sessionId)
        if (!session || !model) {
            return
        }

        model.terminal.write(payload.data)
        model.renderedLength += payload.data.length
    }

    function handleSessionExit(payload) {
        const session = orderedSessions.find(item => item.id === payload.sessionId)
        if (!session) {
            return
        }

        session.status = 'exited'
        session.exitCode = payload.exitCode
        renderTabs()
    }

    function handleClipboardPaste(payload) {
        if (!payload || !payload.sessionId || typeof payload.text !== 'string' || payload.text.length === 0) {
            return
        }

        const model = sessionModels.get(payload.sessionId)
        if (!model) {
            return
        }

        model.terminal.focus()
        model.terminal.paste(payload.text)
    }

    function populateSettingsForm() {
        setDraftTerminalFontSize(getTerminalFontSize())

        if (interfaceLanguageSelect) {
            interfaceLanguageSelect.value = currentSettings.languagePreference
        }

        if (terminalPaddingCheckbox) {
            terminalPaddingCheckbox.checked = currentSettings.terminalPaddingEnabled
        }

        renderQuickCommandEditors(getQuickCommands())
    }

    function readQuickCommandsFromEditors() {
        if (!quickCommandListElement) {
            return []
        }

        const editors = Array.from(quickCommandListElement.querySelectorAll('.quick-command-editor'))
        const quickCommands = []

        for (const editor of editors) {
            const command = getQuickCommandEditorValue(editor, 'command').trim()
            const label = getQuickCommandEditorValue(editor, 'label').trim()
            const icon = normalizeQuickCommandIconValue(getQuickCommandEditorValue(editor, 'icon'))
            const visibleInput = editor.querySelector('[data-quick-command-field="visible"]')
            const hasDraftContent = command.length > 0 || label.length > 0 || icon.length > 0

            if (!command) {
                if (!hasDraftContent) {
                    continue
                }

                setActiveSettingsTab('commands')
                const commandInput = editor.querySelector('[data-quick-command-field="command"]')
                if (commandInput && typeof commandInput.reportValidity === 'function') {
                    commandInput.setCustomValidity(messages.quickCommandCommandPlaceholder)
                    commandInput.reportValidity()
                    commandInput.focus()
                }
                return undefined
            }

            const commandInput = editor.querySelector('[data-quick-command-field="command"]')
            if (commandInput && typeof commandInput.setCustomValidity === 'function') {
                commandInput.setCustomValidity('')
            }

            quickCommands.push({
                id: editor.dataset.quickCommandId || createDraftQuickCommandId(),
                label: label || command,
                command,
                icon,
                visible: visibleInput ? visibleInput.checked : true
            })
        }

        return quickCommands
    }

    function openSettingsModal() {
        populateSettingsForm()
        setActiveSettingsTab(activeSettingsTab)
        setSettingsPageOpen(true)
        requestAnimationFrame(() => {
            if (activeSettingsTab === 'commands') {
                const firstCommandInput = quickCommandListElement && quickCommandListElement.querySelector('[data-quick-command-field="label"]')
                if (firstCommandInput) {
                    firstCommandInput.focus()
                    return
                }

                addQuickCommandButton && addQuickCommandButton.focus()
                return
            }

            decreaseFontSizeButton.focus()
        })
    }

    function closeSettingsModal() {
        setSettingsPageOpen(false)
        requestAnimationFrame(() => {
            fitActiveSession()
        })
    }

    function saveSettings() {
        const quickCommands = readQuickCommandsFromEditors()
        if (!quickCommands) {
            return
        }

        const nextSettings = {
            terminalFontSize: draftTerminalFontSize,
            languagePreference: normalizeLanguagePreference(interfaceLanguageSelect && interfaceLanguageSelect.value),
            terminalPaddingEnabled: terminalPaddingCheckbox ? terminalPaddingCheckbox.checked : false,
            quickCommands
        }

        applySettings(nextSettings)
        postMessage('update-settings', { settings: nextSettings })
        closeSettingsModal()
    }

    window.addEventListener('message', event => {
        const message = event.data
        if (message.type === 'hydrate') {
            syncState(message.payload)
            return
        }

        if (message.type === 'session-data') {
            handleLiveOutput(message.payload)
            return
        }

        if (message.type === 'session-exit') {
            handleSessionExit(message.payload)
            return
        }

        if (message.type === 'paste-clipboard-data') {
            handleClipboardPaste(message.payload)
        }
    })

    newSessionButton.addEventListener('click', () => {
        postMessage('create-session')
    })

    createFirstSessionButton.addEventListener('click', () => {
        postMessage('create-session')
    })

    decreaseFontSizeButton.addEventListener('click', () => {
        setDraftTerminalFontSize(draftTerminalFontSize - 1)
    })

    increaseFontSizeButton.addEventListener('click', () => {
        setDraftTerminalFontSize(draftTerminalFontSize + 1)
    })

    if (addQuickCommandButton) {
        addQuickCommandButton.addEventListener('click', () => {
            setActiveSettingsTab('commands')
            appendQuickCommandEditor({
                id: createDraftQuickCommandId(),
                label: '',
                command: '',
                icon: '',
                visible: true
            })
        })
    }

    for (const [index, button] of settingsTabButtons.entries()) {
        button.addEventListener('click', () => {
            setActiveSettingsTab(button.getAttribute('data-settings-tab'))
        })

        button.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return
            }

            event.preventDefault()
            const nextIndex = event.key === 'ArrowRight'
                ? (index + 1) % settingsTabButtons.length
                : (index - 1 + settingsTabButtons.length) % settingsTabButtons.length
            const nextButton = settingsTabButtons[nextIndex]
            setActiveSettingsTab(nextButton.getAttribute('data-settings-tab'), { focusTab: true })
        })
    }

    settingsButton.addEventListener('click', () => {
        openSettingsModal()
    })

    settingsCloseButton.addEventListener('click', () => {
        closeSettingsModal()
    })

    settingsCancelButton.addEventListener('click', () => {
        closeSettingsModal()
    })

    settingsSaveButton.addEventListener('click', () => {
        saveSettings()
    })

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isSettingsPageOpen) {
            closeSettingsModal()
        }
    })

    viewportElement.addEventListener('click', () => {
        const model = activeSessionId ? sessionModels.get(activeSessionId) : undefined
        model && model.terminal.focus()
    })

    setSettingsPageOpen(false)
    setActiveSettingsTab(activeSettingsTab)
    applyTranslations(messages, currentLanguage)
    applySettings(currentSettings)
    updateFontSizeStepperState()
    postMessage('ready')
})()
