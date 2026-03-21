import * as vscode from 'vscode'

import type { ShellSpec } from './types'

export function getDefaultCwd(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (folder && folder.uri.scheme === 'file') {
        return folder.uri.fsPath
    }

    return process.cwd()
}

export function getShellSpec(): ShellSpec {
    if (process.platform === 'win32') {
        const integratedConfig = vscode.workspace.getConfiguration('terminal.integrated')
        const defaultProfile = integratedConfig.get<string>('defaultProfile.windows')
        const profiles = integratedConfig.get<Record<string, {
            path?: string | string[]
            args?: string | string[]
        }>>('profiles.windows') ?? {}
        const configuredProfile = defaultProfile ? profiles[defaultProfile] : undefined
        const configuredPath = configuredProfile
            ? readProfilePath(configuredProfile.path)
            : undefined
        const configuredArgs = configuredProfile
            ? readProfileArgs(configuredProfile.args)
            : []

        if (configuredPath) {
            return {
                path: configuredPath,
                args: configuredArgs,
                label: basename(configuredPath)
            }
        }

        const powershell = process.env['POWERSHELL_DISTRIBUTION_CHANNEL']
            ? 'pwsh.exe'
            : undefined
        const fallback = powershell ?? process.env['COMSPEC'] ?? 'cmd.exe'

        return {
            path: fallback,
            args: [],
            label: basename(fallback)
        }
    }

    const shell = process.env['SHELL'] ?? '/bin/bash'
    return {
        path: shell,
        args: [],
        label: basename(shell)
    }
}

function readProfilePath(value: string | string[] | undefined): string | undefined {
    if (!value) {
        return undefined
    }

    if (Array.isArray(value)) {
        return value[0]
    }

    return value
}

function readProfileArgs(value: string | string[] | undefined): string[] {
    if (!value) {
        return []
    }

    if (Array.isArray(value)) {
        return value
    }

    return [value]
}

function basename(filePath: string): string {
    const segments = filePath.split(/[\\/]/)
    return segments[segments.length - 1].replace(/\.exe$/i, '')
}
