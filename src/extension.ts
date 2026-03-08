import * as vscode from 'vscode'
import {
    CLOSE_ACTIVE_TERMINAL_COMMAND,
    FOCUS_ACTIVE_TERMINAL_COMMAND,
    NEW_EDITOR_TERMINAL_COMMAND,
    NEW_PANEL_TERMINAL_COMMAND,
    OPEN_COMMAND,
    SPLIT_ACTIVE_TERMINAL_COMMAND,
    TerminalSidebarProvider,
    VIEW_ID
} from './terminalSidebarProvider'

export function activate(context: vscode.ExtensionContext) {
    const provider = new TerminalSidebarProvider(context)

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            VIEW_ID,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    )

    const button = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    )

    button.text = '$(terminal) Terminal'
    button.command = OPEN_COMMAND
    button.show()

    context.subscriptions.push(button)
    context.subscriptions.push(
        vscode.commands.registerCommand(OPEN_COMMAND, async () => {
            await provider.reveal()
        }),
        vscode.commands.registerCommand(NEW_EDITOR_TERMINAL_COMMAND, async () => {
            await provider.createEditorTerminal()
        }),
        vscode.commands.registerCommand(NEW_PANEL_TERMINAL_COMMAND, async () => {
            await provider.createPanelTerminal()
        }),
        vscode.commands.registerCommand(SPLIT_ACTIVE_TERMINAL_COMMAND, async () => {
            await provider.splitActiveTerminal()
        }),
        vscode.commands.registerCommand(FOCUS_ACTIVE_TERMINAL_COMMAND, () => {
            provider.focusActiveTerminal()
        }),
        vscode.commands.registerCommand(CLOSE_ACTIVE_TERMINAL_COMMAND, () => {
            provider.closeActiveTerminal()
        }),
        vscode.window.onDidOpenTerminal(() => {
            provider.refreshTerminals()
        }),
        vscode.window.onDidCloseTerminal(() => {
            provider.refreshTerminals()
        }),
        vscode.window.onDidChangeActiveTerminal(() => {
            provider.refreshTerminals()
        }),
        vscode.window.onDidChangeTerminalState(() => {
            provider.refreshTerminals()
        }),
        vscode.window.onDidChangeTerminalShellIntegration(() => {
            provider.refreshTerminals()
        })
    )

    provider.refreshTerminals()
}

export function deactivate() {}
