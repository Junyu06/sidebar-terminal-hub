import * as vscode from 'vscode'

import {
    DEFAULT_QUICK_COMMANDS,
    FONT_SIZE_MAX,
    FONT_SIZE_MIN
} from './constants'
import { normalizeLanguagePreference } from './i18n'
import type {
    SidebarQuickCommand,
    SidebarSettings,
    StoredSidebarQuickCommand,
    StoredSidebarSettings
} from './types'

export function normalizeSettings(settings?: StoredSidebarSettings): SidebarSettings {
    return {
        terminalFontSize: normalizeFontSize(settings?.terminalFontSize),
        languagePreference: normalizeLanguagePreference(settings?.languagePreference),
        terminalPaddingEnabled: normalizeTerminalPaddingEnabled(settings?.terminalPaddingEnabled),
        showTerminalScrollbar: normalizeShowTerminalScrollbar(
            settings?.showTerminalScrollbar,
            settings?.hideTerminalScrollbar
        ),
        quickCommands: normalizeQuickCommands(settings?.quickCommands, settings?.commandButtons)
    }
}

export function getDefaultTerminalFontSize(): number {
    const terminalFontSize = vscode.workspace
        .getConfiguration('terminal.integrated')
        .get<number>('fontSize')

    if (typeof terminalFontSize === 'number' && Number.isFinite(terminalFontSize) && terminalFontSize > 0) {
        return terminalFontSize
    }

    const editorFontSize = vscode.workspace
        .getConfiguration('editor')
        .get<number>('fontSize')

    if (typeof editorFontSize === 'number' && Number.isFinite(editorFontSize) && editorFontSize > 0) {
        return editorFontSize
    }

    return 13
}

function normalizeTerminalPaddingEnabled(value: boolean | undefined): boolean {
    return value === true
}

function normalizeShowTerminalScrollbar(
    showTerminalScrollbar: boolean | undefined,
    hideTerminalScrollbar: boolean | undefined
): boolean {
    if (showTerminalScrollbar !== undefined) {
        return showTerminalScrollbar === true
    }

    if (hideTerminalScrollbar !== undefined) {
        return hideTerminalScrollbar !== true
    }

    return true
}

function normalizeFontSize(fontSize: number | undefined): number | undefined {
    if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) {
        return undefined
    }

    return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(fontSize)))
}

function normalizeQuickCommands(
    commands: StoredSidebarQuickCommand[] | undefined,
    legacyCommandButtons: Record<string, boolean> | undefined
): SidebarQuickCommand[] {
    const defaults = getDefaultQuickCommands(legacyCommandButtons)

    if (!Array.isArray(commands)) {
        return defaults
    }

    const defaultMap = new Map(defaults.map(command => [command.id, command]))
    const usedIds = new Set<string>()
    const normalized: SidebarQuickCommand[] = []

    for (const [index, command] of commands.entries()) {
        const defaultCommand = typeof command?.id === 'string'
            ? defaultMap.get(command.id.trim())
            : undefined
        const nextCommand = normalizeQuickCommand(command, index, defaultCommand, usedIds)
        if (nextCommand) {
            normalized.push(nextCommand)
        }
    }

    return normalized
}

function normalizeQuickCommand(
    command: StoredSidebarQuickCommand | undefined,
    index: number,
    defaultCommand: SidebarQuickCommand | undefined,
    usedIds: Set<string>
): SidebarQuickCommand | undefined {
    const rawCommand = typeof command?.command === 'string'
        ? command.command.trim()
        : defaultCommand?.command ?? ''

    if (!rawCommand) {
        return undefined
    }

    const label = normalizeQuickCommandLabel(command?.label, rawCommand, defaultCommand?.label, index)
    const preferredId = typeof command?.id === 'string' && command.id.trim().length > 0
        ? command.id.trim()
        : defaultCommand?.id ?? `quick-command-${index + 1}`

    return {
        id: makeUniqueQuickCommandId(preferredId, usedIds),
        label,
        command: rawCommand,
        icon: normalizeQuickCommandIcon(command?.icon, defaultCommand?.icon ?? ''),
        visible: typeof command?.visible === 'boolean'
            ? command.visible
            : defaultCommand?.visible ?? true
    }
}

function getDefaultQuickCommands(
    legacyCommandButtons: Record<string, boolean> | undefined
): SidebarQuickCommand[] {
    return DEFAULT_QUICK_COMMANDS.map(command => ({
        id: command.id,
        label: command.label,
        command: command.command,
        icon: command.icon,
        visible: legacyCommandButtons?.[command.id] ?? true
    }))
}

function normalizeQuickCommandLabel(
    label: string | undefined,
    command: string,
    fallbackLabel: string | undefined,
    index: number
): string {
    const nextLabel = typeof label === 'string' ? label.trim() : ''
    if (nextLabel) {
        return nextLabel
    }

    if (fallbackLabel && fallbackLabel.trim()) {
        return fallbackLabel.trim()
    }

    return command || `Command ${index + 1}`
}

function normalizeQuickCommandIcon(
    icon: string | undefined,
    fallbackIcon: string
): string {
    if (typeof icon === 'string') {
        return sanitizeQuickCommandIcon(icon)
    }

    return sanitizeQuickCommandIcon(fallbackIcon)
}

function sanitizeQuickCommandIcon(icon: string): string {
    const value = icon.trim()

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

function normalizeInlineSvgMarkup(svgMarkup: string): string {
    const value = svgMarkup.trim()
    const openingTagMatch = value.match(/^<svg\b[^>]*>/i)

    if (!openingTagMatch) {
        return value
    }

    if (/\sxmlns\s*=\s*['"][^'"]+['"]/i.test(openingTagMatch[0])) {
        return value
    }

    return value.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
}

function makeUniqueQuickCommandId(preferredId: string, usedIds: Set<string>): string {
    let nextId = preferredId
    let suffix = 2

    while (usedIds.has(nextId)) {
        nextId = `${preferredId}-${suffix}`
        suffix += 1
    }

    usedIds.add(nextId)
    return nextId
}
