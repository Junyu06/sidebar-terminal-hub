(function () {
    const vscode = acquireVsCodeApi()
    const config = window.__RST_CONFIG__ || {}

    const quickCommands = Array.isArray(config.quickCommands) ? config.quickCommands : []
    const defaultTerminalFontSize = Number.isFinite(config.defaultTerminalFontSize)
        ? config.defaultTerminalFontSize
        : 13

    const tabsElement = document.getElementById('tabs')
    const viewportElement = document.getElementById('viewport')
    const emptyStateElement = document.getElementById('empty-state')
    const tabCountElement = document.getElementById('tab-count')
    const newSessionButton = document.getElementById('new-session')
    const createFirstSessionButton = document.getElementById('create-first-session')
    const settingsButton = document.getElementById('open-settings')
    const settingsModal = document.getElementById('settings-modal')
    const settingsCloseButton = document.getElementById('settings-close')
    const settingsCancelButton = document.getElementById('settings-cancel')
    const settingsSaveButton = document.getElementById('settings-save')
    const terminalFontSizeInput = document.getElementById('terminal-font-size')

    const sessionModels = new Map()
    let orderedSessions = []
    let activeSessionId = undefined
    let currentSettings = normalizeSettings(config.settings)

    const quickCommandButtons = new Map(
        quickCommands.map(command => [
            command.id,
            document.querySelector(`[data-quick-command-id="${command.id}"]`)
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

        return Math.max(10, Math.min(32, Math.round(value)))
    }

    function normalizeSettings(value) {
        const inputButtons = value && value.commandButtons || {}
        const commandButtons = {}

        for (const command of quickCommands) {
            commandButtons[command.id] = inputButtons[command.id] !== false
        }

        return {
            terminalFontSize: clampFontSize(value && value.terminalFontSize),
            commandButtons
        }
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
            const button = quickCommandButtons.get(command.id)
            if (button) {
                button.classList.toggle('hidden', !currentSettings.commandButtons[command.id])
            }
        }

        refreshTerminalAppearance()
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
        tabCountElement.textContent = `${orderedSessions.length} tab${orderedSessions.length === 1 ? '' : 's'}`

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
            closeButton.title = `Close ${session.name}`
            closeButton.setAttribute('aria-label', `Close ${session.name}`)
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
        const incomingIds = new Set(payload.sessions.map(session => session.id))

        for (const existingId of Array.from(sessionModels.keys())) {
            if (!incomingIds.has(existingId)) {
                disposeSessionModel(existingId)
            }
        }

        orderedSessions = payload.sessions
        applySettings(payload.settings || currentSettings)

        for (const session of payload.sessions) {
            let model = sessionModels.get(session.id)
            if (!model) {
                model = createSessionModel(session)
            } else {
                model = syncSessionBuffer(model, session)
            }
        }

        const nextActiveSessionId = payload.activeSessionId || payload.sessions[0] && payload.sessions[0].id
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
        terminalFontSizeInput.value = String(getTerminalFontSize())

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
            terminalFontSizeInput.focus()
            terminalFontSizeInput.select()
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
            terminalFontSize: clampFontSize(Number(terminalFontSizeInput.value)) || defaultTerminalFontSize,
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

    for (const command of quickCommands) {
        const button = quickCommandButtons.get(command.id)
        if (!button) {
            continue
        }

        button.addEventListener('click', () => {
            postMessage('create-quick-session', { quickCommandId: command.id })
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

    applySettings(currentSettings)
    postMessage('ready')
})()
