import * as vscode from 'vscode'

export const VIEW_ID = 'rstTerminalSecondaryView'
export const CONTAINER_ID = 'rst-terminal-secondary-container'
export const OPEN_COMMAND = 'terminalSidebar.open'
export const NEW_EDITOR_TERMINAL_COMMAND = 'terminalSidebar.newEditorTerminal'
export const NEW_PANEL_TERMINAL_COMMAND = 'terminalSidebar.newPanelTerminal'
export const SPLIT_ACTIVE_TERMINAL_COMMAND = 'terminalSidebar.splitActiveTerminal'
export const FOCUS_ACTIVE_TERMINAL_COMMAND = 'terminalSidebar.focusActiveTerminal'
export const CLOSE_ACTIVE_TERMINAL_COMMAND = 'terminalSidebar.closeActiveTerminal'

const PREFERRED_LOCATION_KEY = 'terminalSidebar.preferredLocation'

type TerminalTargetLocation = 'editor' | 'panel'
type TerminalLocationLabel = TerminalTargetLocation | 'split'

type WebviewMessage =
    | { type: 'ready' }
    | { type: 'create-terminal'; location: TerminalTargetLocation }
    | { type: 'focus-terminal'; terminalId: string }
    | { type: 'close-terminal'; terminalId: string }
    | { type: 'run-command'; terminalId?: string; command: string; shouldExecute: boolean }
    | { type: 'set-preferred-location'; location: TerminalTargetLocation }
    | { type: 'split-active-terminal' }
    | { type: 'focus-active-terminal' }
    | { type: 'close-active-terminal' }
    | { type: 'refresh' }

interface TerminalSnapshot {
    id: string
    name: string
    shell: string
    location: TerminalLocationLabel
    isActive: boolean
    hasInteracted: boolean
    isManaged: boolean
}

interface WebviewStatePayload {
    activeTerminalId?: string
    preferredLocation: TerminalTargetLocation
    terminals: TerminalSnapshot[]
}

export class TerminalSidebarProvider implements vscode.WebviewViewProvider {
    private readonly terminalIds = new Map<vscode.Terminal, string>()
    private readonly terminalsById = new Map<string, vscode.Terminal>()
    private readonly managedTerminalIds = new Set<string>()
    private nextTerminalId = 1
    private nextManagedTerminalNumber = 1
    private view?: vscode.WebviewView

    constructor(private readonly context: vscode.ExtensionContext) {}

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

        void vscode.window.showErrorMessage('Unable to reveal the terminal sidebar view.')
    }

    async createEditorTerminal() {
        await this.reveal()
        this.createManagedTerminal('editor', false)
    }

    async createPanelTerminal() {
        await this.reveal()
        this.createManagedTerminal('panel', false)
    }

    async splitActiveTerminal() {
        await this.reveal()

        const parentTerminal = this.getTargetTerminal()
        if (!parentTerminal) {
            this.createManagedTerminal(this.getPreferredLocation(), false)
            return
        }

        const terminal = vscode.window.createTerminal({
            name: this.getNextManagedTerminalName(),
            cwd: this.getDefaultCwd(),
            location: { parentTerminal }
        })

        this.ensureTerminal(terminal, true)
        terminal.show(false)
        this.refreshTerminals()
    }

    focusActiveTerminal() {
        const terminal = this.getTargetTerminal()
        if (!terminal) {
            void vscode.window.showInformationMessage('No terminal is available yet.')
            return
        }

        terminal.show(false)
    }

    closeActiveTerminal() {
        const terminal = this.getTargetTerminal()
        if (!terminal) {
            void vscode.window.showInformationMessage('No terminal is available yet.')
            return
        }

        terminal.dispose()
    }

    refreshTerminals() {
        const currentTerminals = new Set(vscode.window.terminals)

        for (const terminal of Array.from(this.terminalIds.keys())) {
            if (!currentTerminals.has(terminal)) {
                this.removeTerminal(terminal)
            }
        }

        for (const terminal of currentTerminals) {
            this.ensureTerminal(terminal)
        }

        this.postState()
    }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view

        view.onDidDispose(() => {
            if (this.view === view) {
                this.view = undefined
            }
        })

        view.webview.options = {
            enableScripts: true
        }

        view.webview.onDidReceiveMessage((message: WebviewMessage) => {
            void this.handleMessage(message)
        })

        view.webview.html = this.getHtml(view.webview)
        this.refreshTerminals()
    }

    private async handleMessage(message: WebviewMessage) {
        switch (message.type) {
            case 'ready':
            case 'refresh':
                this.refreshTerminals()
                return
            case 'create-terminal':
                await this.reveal()
                this.createManagedTerminal(message.location, false)
                return
            case 'focus-terminal':
                this.terminalsById.get(message.terminalId)?.show(false)
                return
            case 'close-terminal':
                this.terminalsById.get(message.terminalId)?.dispose()
                return
            case 'run-command':
                await this.runCommand(message.command, message.shouldExecute, message.terminalId)
                return
            case 'set-preferred-location':
                await this.context.workspaceState.update(PREFERRED_LOCATION_KEY, message.location)
                this.postState()
                return
            case 'split-active-terminal':
                await this.splitActiveTerminal()
                return
            case 'focus-active-terminal':
                this.focusActiveTerminal()
                return
            case 'close-active-terminal':
                this.closeActiveTerminal()
                return
        }
    }

    private createManagedTerminal(location: TerminalTargetLocation, preserveFocus: boolean) {
        const terminal = vscode.window.createTerminal({
            name: this.getNextManagedTerminalName(),
            cwd: this.getDefaultCwd(),
            location: location === 'editor' ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel
        })

        this.ensureTerminal(terminal, true)
        terminal.show(preserveFocus)
        this.refreshTerminals()
        return terminal
    }

    private async runCommand(command: string, shouldExecute: boolean, terminalId?: string) {
        if (command.trim().length === 0) {
            return
        }

        await this.reveal()

        let terminal = this.getTargetTerminal(terminalId)
        if (!terminal) {
            terminal = this.createManagedTerminal(this.getPreferredLocation(), true)
        }

        terminal.show(true)
        terminal.sendText(command, shouldExecute)
        this.refreshTerminals()
    }

    private ensureTerminal(terminal: vscode.Terminal, managed = false) {
        const existingId = this.terminalIds.get(terminal)
        if (existingId) {
            if (managed) {
                this.managedTerminalIds.add(existingId)
            }
            return existingId
        }

        const terminalId = `terminal-${this.nextTerminalId++}`
        this.terminalIds.set(terminal, terminalId)
        this.terminalsById.set(terminalId, terminal)

        if (managed) {
            this.managedTerminalIds.add(terminalId)
        }

        return terminalId
    }

    private removeTerminal(terminal: vscode.Terminal) {
        const terminalId = this.terminalIds.get(terminal)
        if (!terminalId) {
            return
        }

        this.terminalIds.delete(terminal)
        this.terminalsById.delete(terminalId)
        this.managedTerminalIds.delete(terminalId)
    }

    private getTargetTerminal(terminalId?: string) {
        if (terminalId) {
            return this.terminalsById.get(terminalId)
        }

        return vscode.window.activeTerminal ?? vscode.window.terminals[0]
    }

    private getPreferredLocation(): TerminalTargetLocation {
        return this.context.workspaceState.get<TerminalTargetLocation>(PREFERRED_LOCATION_KEY) === 'panel'
            ? 'panel'
            : 'editor'
    }

    private getDefaultCwd() {
        return vscode.workspace.workspaceFolders?.[0]?.uri
    }

    private getNextManagedTerminalName() {
        return `Terminal ${this.nextManagedTerminalNumber++}`
    }

    private postState() {
        if (!this.view) {
            return
        }

        const activeTerminal = vscode.window.activeTerminal
        const terminals = vscode.window.terminals.map(terminal => this.toTerminalSnapshot(terminal))
        const payload: WebviewStatePayload = {
            activeTerminalId: activeTerminal ? this.ensureTerminal(activeTerminal) : terminals[0]?.id,
            preferredLocation: this.getPreferredLocation(),
            terminals
        }

        void this.view.webview.postMessage({
            type: 'state',
            payload
        })
    }

    private toTerminalSnapshot(terminal: vscode.Terminal): TerminalSnapshot {
        const id = this.ensureTerminal(terminal)

        return {
            id,
            name: terminal.name,
            shell: this.getShellLabel(terminal),
            location: this.getLocationLabel(terminal),
            isActive: vscode.window.activeTerminal === terminal,
            hasInteracted: terminal.state.isInteractedWith,
            isManaged: this.managedTerminalIds.has(id)
        }
    }

    private getShellLabel(terminal: vscode.Terminal) {
        if (terminal.state.shell) {
            return terminal.state.shell
        }

        const creationOptions = terminal.creationOptions
        const shellPath = 'shellPath' in creationOptions ? creationOptions.shellPath : undefined
        if (!shellPath) {
            return 'shell'
        }

        const parts = shellPath.split(/[\\\\/]/)
        return parts[parts.length - 1].replace(/\\.exe$/i, '')
    }

    private getLocationLabel(terminal: vscode.Terminal): TerminalLocationLabel {
        const location = terminal.creationOptions.location

        if (location === vscode.TerminalLocation.Editor) {
            return 'editor'
        }

        if (location === vscode.TerminalLocation.Panel) {
            return 'panel'
        }

        if (typeof location === 'object' && location) {
            if ('parentTerminal' in location) {
                return 'split'
            }

            if ('viewColumn' in location) {
                return 'editor'
            }
        }

        return 'panel'
    }

    private getHtml(webview: vscode.Webview) {
        const nonce = this.getNonce()

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Terminal Manager</title>
    <style>
        :root {
            color-scheme: light dark;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 12px;
            background: var(--vscode-sideBar-background);
            color: var(--vscode-sideBar-foreground);
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }

        .app {
            display: grid;
            gap: 12px;
        }

        .card {
            background: color-mix(in srgb, var(--vscode-editorWidget-background) 88%, transparent);
            border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.22));
            border-radius: 10px;
            padding: 12px;
        }

        .hero {
            display: grid;
            gap: 10px;
        }

        .hero-top {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            align-items: flex-start;
        }

        .title {
            margin: 0;
            font-size: 15px;
            font-weight: 600;
        }

        .subtitle {
            margin: 4px 0 0;
            color: var(--vscode-descriptionForeground);
            line-height: 1.45;
        }

        .toolbar,
        .action-row,
        .location-switch {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        button {
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
            color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
            border-radius: 8px;
            min-height: 30px;
            padding: 0 10px;
            cursor: pointer;
            font: inherit;
        }

        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        button:hover {
            background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
        }

        button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.ghost {
            background: transparent;
            color: var(--vscode-descriptionForeground);
        }

        button.active-switch {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 10px;
        }

        .section-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .count {
            padding: 2px 8px;
            border-radius: 999px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 11px;
            font-weight: 600;
        }

        .tabs {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            padding-bottom: 2px;
        }

        .tabs::-webkit-scrollbar {
            height: 8px;
        }

        .tabs::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 999px;
        }

        .tab {
            min-width: 180px;
            max-width: 240px;
            border-radius: 10px;
            border: 1px solid transparent;
            background: var(--vscode-sideBarSectionHeader-background, rgba(127, 127, 127, 0.08));
            padding: 10px;
            display: grid;
            gap: 6px;
        }

        .tab.active {
            border-color: var(--vscode-focusBorder);
            background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }

        .tab-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
        }

        .tab-main {
            background: transparent;
            border: none;
            padding: 0;
            min-height: unset;
            color: inherit;
            text-align: left;
            width: 100%;
        }

        .tab-name {
            display: block;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tab-meta {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 11px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .badge.subtle {
            background: color-mix(in srgb, var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.24)) 30%, transparent);
            color: var(--vscode-descriptionForeground);
        }

        .detail-grid {
            display: grid;
            gap: 10px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .detail-item {
            display: grid;
            gap: 4px;
            padding: 10px;
            border-radius: 10px;
            background: color-mix(in srgb, var(--vscode-sideBarSectionHeader-background, rgba(127, 127, 127, 0.08)) 90%, transparent);
        }

        .detail-label {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .detail-value {
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        textarea {
            width: 100%;
            min-height: 92px;
            resize: vertical;
            border-radius: 10px;
            border: 1px solid var(--vscode-input-border, transparent);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            padding: 10px 12px;
            font: inherit;
        }

        textarea:focus,
        button:focus-visible,
        .tab-main:focus-visible {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 1px;
        }

        .hint,
        .empty-copy {
            color: var(--vscode-descriptionForeground);
            line-height: 1.45;
        }

        .empty {
            display: grid;
            gap: 10px;
        }
    </style>
</head>
<body>
    <div class="app">
        <section class="card hero">
            <div class="hero-top">
                <div>
                    <h1 class="title">Native Terminal Manager</h1>
                    <p class="subtitle">Uses VS Code's built-in terminal. This sidebar manages native terminal tabs and lets you send commands quickly.</p>
                </div>
            </div>
            <div class="toolbar">
                <button id="new-editor-terminal" class="primary">New Editor Tab</button>
                <button id="new-panel-terminal">New Panel Tab</button>
                <button id="split-active-terminal">Split Active</button>
                <button id="focus-active-terminal" class="ghost">Focus Active</button>
            </div>
            <div class="location-switch">
                <button id="location-editor">Default: Editor Tabs</button>
                <button id="location-panel">Default: Panel Tabs</button>
            </div>
        </section>

        <section class="card">
            <div class="section-head">
                <div class="section-title">Terminal Tabs</div>
                <div id="terminal-count" class="count">0</div>
            </div>
            <div id="tabs" class="tabs"></div>
        </section>

        <section class="card">
            <div class="section-head">
                <div class="section-title">Current Session</div>
            </div>
            <div id="empty-state" class="empty">
                <div class="empty-copy">No terminal yet. Create one as an editor tab or panel tab and it will appear here.</div>
                <div class="action-row">
                    <button id="empty-new-editor" class="primary">Create Editor Tab</button>
                    <button id="empty-new-panel">Create Panel Tab</button>
                </div>
            </div>
            <div id="detail-view" hidden>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-label">Name</div>
                        <div id="detail-name" class="detail-value"></div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Shell</div>
                        <div id="detail-shell" class="detail-value"></div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Location</div>
                        <div id="detail-location" class="detail-value"></div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Source</div>
                        <div id="detail-source" class="detail-value"></div>
                    </div>
                </div>
                <div class="action-row" style="margin-top: 10px;">
                    <button id="detail-focus" class="primary">Open Native Terminal</button>
                    <button id="detail-close">Close Tab</button>
                </div>
            </div>
        </section>

        <section class="card">
            <div class="section-head">
                <div class="section-title">Command Composer</div>
            </div>
            <textarea id="command-input" placeholder="Type a command to send to the active native terminal. Enter runs it, Shift+Enter pastes without executing."></textarea>
            <div class="action-row" style="margin-top: 10px;">
                <button id="send-command" class="primary">Send & Run</button>
                <button id="paste-command">Paste Only</button>
                <button id="refresh-terminals" class="ghost">Refresh</button>
            </div>
            <div class="hint" style="margin-top: 10px;">Tip: terminals can open as native editor tabs for a real tabbed experience, or as native panel tabs if you prefer the integrated terminal panel.</div>
        </section>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi()
        const storedUiState = vscode.getState() || {}
        const tabsElement = document.getElementById('tabs')
        const terminalCountElement = document.getElementById('terminal-count')
        const emptyStateElement = document.getElementById('empty-state')
        const detailViewElement = document.getElementById('detail-view')
        const detailNameElement = document.getElementById('detail-name')
        const detailShellElement = document.getElementById('detail-shell')
        const detailLocationElement = document.getElementById('detail-location')
        const detailSourceElement = document.getElementById('detail-source')
        const commandInputElement = document.getElementById('command-input')
        const locationEditorButton = document.getElementById('location-editor')
        const locationPanelButton = document.getElementById('location-panel')
        const detailFocusButton = document.getElementById('detail-focus')
        const detailCloseButton = document.getElementById('detail-close')

        commandInputElement.value = storedUiState.commandDraft || ''

        let state = {
            terminals: [],
            preferredLocation: 'editor',
            activeTerminalId: undefined
        }

        function postMessage(type, extra = {}) {
            vscode.postMessage({ type, ...extra })
        }

        function getCurrentTerminal() {
            return state.terminals.find(terminal => terminal.id === state.activeTerminalId) || state.terminals[0]
        }

        function formatLocation(location) {
            if (location === 'editor') {
                return 'Editor Tab'
            }

            if (location === 'split') {
                return 'Split Terminal'
            }

            return 'Panel Tab'
        }

        function persistCommandDraft() {
            vscode.setState({ commandDraft: commandInputElement.value })
        }

        function createBadge(text, subtle = false) {
            const badge = document.createElement('span')
            badge.className = subtle ? 'badge subtle' : 'badge'
            badge.textContent = text
            return badge
        }

        function renderTabs() {
            tabsElement.replaceChildren()
            terminalCountElement.textContent = String(state.terminals.length)

            for (const terminal of state.terminals) {
                const tab = document.createElement('div')
                tab.className = terminal.isActive ? 'tab active' : 'tab'

                const header = document.createElement('div')
                header.className = 'tab-header'

                const mainButton = document.createElement('button')
                mainButton.className = 'tab-main'
                mainButton.addEventListener('click', () => postMessage('focus-terminal', { terminalId: terminal.id }))

                const name = document.createElement('span')
                name.className = 'tab-name'
                name.textContent = terminal.name
                mainButton.appendChild(name)

                const closeButton = document.createElement('button')
                closeButton.className = 'ghost'
                closeButton.textContent = '×'
                closeButton.title = 'Close terminal'
                closeButton.addEventListener('click', event => {
                    event.stopPropagation()
                    postMessage('close-terminal', { terminalId: terminal.id })
                })

                header.appendChild(mainButton)
                header.appendChild(closeButton)
                tab.appendChild(header)

                const meta = document.createElement('div')
                meta.className = 'tab-meta'
                meta.appendChild(createBadge(formatLocation(terminal.location)))
                meta.appendChild(createBadge(terminal.shell, true))
                if (terminal.isManaged) {
                    meta.appendChild(createBadge('Managed', true))
                }
                if (terminal.hasInteracted) {
                    meta.appendChild(createBadge('Used', true))
                }

                tab.appendChild(meta)
                tabsElement.appendChild(tab)
            }
        }

        function renderDetails() {
            const currentTerminal = getCurrentTerminal()
            const hasTerminal = Boolean(currentTerminal)
            emptyStateElement.hidden = hasTerminal
            detailViewElement.hidden = !hasTerminal

            if (!currentTerminal) {
                return
            }

            detailNameElement.textContent = currentTerminal.name
            detailShellElement.textContent = currentTerminal.shell
            detailLocationElement.textContent = formatLocation(currentTerminal.location)
            detailSourceElement.textContent = currentTerminal.isManaged ? 'Created from sidebar' : 'Existing native terminal'
        }

        function renderLocationPreference() {
            locationEditorButton.classList.toggle('active-switch', state.preferredLocation === 'editor')
            locationPanelButton.classList.toggle('active-switch', state.preferredLocation === 'panel')
        }

        function render() {
            renderTabs()
            renderDetails()
            renderLocationPreference()
        }

        function sendCommand(shouldExecute) {
            const currentTerminal = getCurrentTerminal()
            postMessage('run-command', {
                terminalId: currentTerminal && currentTerminal.id,
                command: commandInputElement.value,
                shouldExecute
            })
            commandInputElement.value = ''
            persistCommandDraft()
        }

        document.getElementById('new-editor-terminal').addEventListener('click', () => postMessage('create-terminal', { location: 'editor' }))
        document.getElementById('new-panel-terminal').addEventListener('click', () => postMessage('create-terminal', { location: 'panel' }))
        document.getElementById('split-active-terminal').addEventListener('click', () => postMessage('split-active-terminal'))
        document.getElementById('focus-active-terminal').addEventListener('click', () => postMessage('focus-active-terminal'))
        document.getElementById('send-command').addEventListener('click', () => sendCommand(true))
        document.getElementById('paste-command').addEventListener('click', () => sendCommand(false))
        document.getElementById('refresh-terminals').addEventListener('click', () => postMessage('refresh'))
        document.getElementById('empty-new-editor').addEventListener('click', () => postMessage('create-terminal', { location: 'editor' }))
        document.getElementById('empty-new-panel').addEventListener('click', () => postMessage('create-terminal', { location: 'panel' }))

        locationEditorButton.addEventListener('click', () => postMessage('set-preferred-location', { location: 'editor' }))
        locationPanelButton.addEventListener('click', () => postMessage('set-preferred-location', { location: 'panel' }))

        detailFocusButton.addEventListener('click', () => {
            const currentTerminal = getCurrentTerminal()
            if (currentTerminal) {
                postMessage('focus-terminal', { terminalId: currentTerminal.id })
            }
        })

        detailCloseButton.addEventListener('click', () => {
            const currentTerminal = getCurrentTerminal()
            if (currentTerminal) {
                postMessage('close-terminal', { terminalId: currentTerminal.id })
            }
        })

        commandInputElement.addEventListener('input', persistCommandDraft)
        commandInputElement.addEventListener('keydown', event => {
            if (event.key !== 'Enter') {
                return
            }

            event.preventDefault()
            sendCommand(!event.shiftKey)
        })

        window.addEventListener('message', event => {
            const message = event.data
            if (message.type !== 'state') {
                return
            }

            state = message.payload
            render()
        })

        postMessage('ready')
    </script>
</body>
</html>`
    }

    private getNonce() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        let value = ''

        for (let index = 0; index < 32; index += 1) {
            value += chars.charAt(Math.floor(Math.random() * chars.length))
        }

        return value
    }
}

