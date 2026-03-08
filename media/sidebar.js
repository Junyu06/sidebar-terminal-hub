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
    }

    const quickCommands = Array.isArray(config.quickCommands) ? config.quickCommands : []
    const defaultTerminalFontSize = Number.isFinite(config.defaultTerminalFontSize)
        ? config.defaultTerminalFontSize
        : 13

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
    const quickLaunchLabelElement = document.getElementById('quick-launch-label')
    const settingsModal = document.getElementById('settings-modal')
    const settingsTitleElement = document.getElementById('settings-title')
    const settingsSubtitleElement = document.getElementById('settings-subtitle')
    const settingsCloseButton = document.getElementById('settings-close')
    const settingsCancelButton = document.getElementById('settings-cancel')
    const settingsSaveButton = document.getElementById('settings-save')
    const terminalFontSizeLabelElement = document.getElementById('terminal-font-size-label')
    const terminalFontSizeValueElement = document.getElementById('terminal-font-size-value')
    const decreaseFontSizeButton = document.getElementById('decrease-font-size')
    const increaseFontSizeButton = document.getElementById('increase-font-size')
    const interfaceLanguageLabelElement = document.getElementById('interface-language-label')
    const interfaceLanguageSelect = document.getElementById('interface-language')
    const commandButtonsTitleElement = document.getElementById('command-buttons-title')

    const sessionModels = new Map()
    let orderedSessions = []
    let activeSessionId = undefined
    let currentLanguage = config.language === 'zh-CN' ? 'zh-CN' : 'en'
    let messages = normalizeMessages(config.messages)
    let currentSettings = normalizeSettings(config.settings)
    let draftTerminalFontSize = getTerminalFontSize()

    const quickCommandButtons = new Map(
        quickCommands.map(command => [
            command.id,
            Array.from(document.querySelectorAll(`[data-quick-command-id="${command.id}"]`))
        ])
    )

    const quickCommandToggles = new Map(
        quickCommands.map(command => [
            command.id,
            document.querySelector(`[data-toggle-command-id="${command.id}"]`)
        ])
    )

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

    function normalizeSettings(value) {
        const inputButtons = value && value.commandButtons || {}
        const commandButtons = {}

        for (const command of quickCommands) {
            commandButtons[command.id] = inputButtons[command.id] !== false
        }

        return {
            terminalFontSize: clampFontSize(value && value.terminalFontSize),
            languagePreference: normalizeLanguagePreference(value && value.languagePreference),
            commandButtons
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

    function applySettings(nextSettings) {
        currentSettings = normalizeSettings(nextSettings)

        for (const command of quickCommands) {
            const buttons = quickCommandButtons.get(command.id) || []
            for (const button of buttons) {
                button.classList.toggle('hidden', !currentSettings.commandButtons[command.id])
            }
        }

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

        settingsCancelButton.textContent = messages.cancel
        settingsSaveButton.textContent = messages.save

        for (const command of quickCommands) {
            const title = formatMessage(messages.openQuickTerminalTitle, { label: command.label })
            const ariaLabel = formatMessage(messages.openQuickTerminalAria, { label: command.label })

            for (const button of quickCommandButtons.get(command.id) || []) {
                button.title = title
                button.setAttribute('aria-label', ariaLabel)
            }
        }
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

    function populateSettingsForm() {
        setDraftTerminalFontSize(getTerminalFontSize())

        if (interfaceLanguageSelect) {
            interfaceLanguageSelect.value = currentSettings.languagePreference
        }

        for (const command of quickCommands) {
            const toggle = quickCommandToggles.get(command.id)
            if (toggle) {
                toggle.checked = currentSettings.commandButtons[command.id]
            }
        }
    }

    function openSettingsModal() {
        populateSettingsForm()
        settingsModal.classList.remove('hidden')
        requestAnimationFrame(() => {
            decreaseFontSizeButton.focus()
        })
    }

    function closeSettingsModal() {
        settingsModal.classList.add('hidden')
    }

    function saveSettings() {
        const commandButtons = {}

        for (const command of quickCommands) {
            const toggle = quickCommandToggles.get(command.id)
            commandButtons[command.id] = toggle ? toggle.checked : true
        }

        const nextSettings = {
            terminalFontSize: draftTerminalFontSize,
            languagePreference: normalizeLanguagePreference(interfaceLanguageSelect && interfaceLanguageSelect.value),
            commandButtons
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

    for (const command of quickCommands) {
        for (const button of quickCommandButtons.get(command.id) || []) {
            button.addEventListener('click', () => {
                postMessage('create-quick-session', { quickCommandId: command.id })
            })
        }
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

    settingsModal.addEventListener('click', event => {
        if (event.target === settingsModal) {
            closeSettingsModal()
        }
    })

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            closeSettingsModal()
        }
    })

    viewportElement.addEventListener('click', () => {
        const model = activeSessionId ? sessionModels.get(activeSessionId) : undefined
        model && model.terminal.focus()
    })

    applyTranslations(messages, currentLanguage)
    applySettings(currentSettings)
    updateFontSizeStepperState()
    postMessage('ready')
})()
