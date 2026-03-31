import * as vscode from 'vscode'
import {
    CLOSE_ACTIVE_SESSION_COMMAND,
    NEW_SESSION_COMMAND,
    OPEN_COMMAND,
    TerminalSidebarProvider,
    VIEW_ID
} from './terminalSidebarProvider'

let providerInstance: TerminalSidebarProvider | undefined

export function activate(context: vscode.ExtensionContext) {
    const provider = new TerminalSidebarProvider(context)
    providerInstance = provider

    context.subscriptions.push(provider)
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
        vscode.commands.registerCommand(NEW_SESSION_COMMAND, async () => {
            await provider.createSession()
        }),
        vscode.commands.registerCommand(CLOSE_ACTIVE_SESSION_COMMAND, () => {
            provider.closeActiveSession()
        })
    )
}

export function deactivate() {
    return providerInstance?.prepareForShutdown()
}
