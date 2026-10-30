import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parse } from 'jsonc-parser'
import { parseRawGrammar, type IRawTheme } from 'vscode-textmate'
import * as vscode from 'vscode'

type Rule = IRawTheme['settings'][number]
type Customizations = Record<string, unknown> & { textMateRules?: Rule[] }
interface ThemeFile {
    include?: string
    colors?: Record<string, string>
    tokenColors?: Rule[] | string
    settings?: Rule[]
}
interface ThemeContribution {
    id?: string
    label?: string
    path: string
}

// The same category scopes used by VS Code's editor.tokenColorCustomizations.
const groups: Record<string, string[]> = {
    comments: ['comment', 'punctuation.definition.comment'],
    strings: ['string', 'meta.embedded.assembly'],
    keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
    numbers: ['constant.numeric'],
    types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
    functions: ['entity.name.function', 'support.function'],
    variables: ['variable', 'entity.name.variable'],
}

function matchesTheme(selector: string, name: string): boolean {
    return [...selector.matchAll(/\[([^\]]+)\]/g)].some((match) => {
        const pattern = match[1]
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*')
        return new RegExp(`^${pattern}$`).test(name)
    })
}

function scopedSettings(settings: Customizations, name: string): Customizations[] {
    return [
        settings,
        ...Object.entries(settings)
            .filter(([key, value]) => key.startsWith('[') && matchesTheme(key, name) && value && typeof value === 'object')
            .map(([, value]) => value as Customizations),
    ]
}

function customRules(custom: Customizations): Rule[] {
    const result: Rule[] = []
    for (const [group, scope] of Object.entries(groups)) {
        const value = custom[group]
        if (typeof value === 'string') result.push({ scope, settings: { foreground: value } })
        else if (value && typeof value === 'object') result.push({ scope, settings: value as Rule['settings'] })
    }
    if (Array.isArray(custom.textMateRules)) result.push(...custom.textMateRules)
    return result
}

export async function readThemeFile(path: string, ancestors = new Set<string>()): Promise<{ colors: Record<string, string>; rules: Rule[] }> {
    if (ancestors.has(path)) throw new Error('Circular color theme include')
    const seen = new Set(ancestors).add(path)
    const text = await readFile(path, 'utf8')
    const data = (path.toLowerCase().endsWith('.tmtheme') ? parseRawGrammar(text, path) : parse(text)) as ThemeFile
    const base = data.include ? await readThemeFile(resolve(dirname(path), data.include), seen) : { colors: {}, rules: [] }
    const external = typeof data.tokenColors === 'string' ? await readThemeFile(resolve(dirname(path), data.tokenColors), seen) : undefined
    const tokens = external?.rules ?? (Array.isArray(data.tokenColors) ? data.tokenColors : (data.settings ?? []))
    const defaults = data.settings?.find((rule) => !rule.scope)?.settings
    const legacyColors: Record<string, string> = {}
    if (defaults?.foreground) legacyColors['editor.foreground'] = defaults.foreground
    if (defaults?.background) legacyColors['editor.background'] = defaults.background
    return { colors: { ...base.colors, ...external?.colors, ...legacyColors, ...data.colors }, rules: [...base.rules, ...tokens] }
}

function normalizeColor(color: string | undefined): string | undefined {
    if (!color || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return undefined
    return color.length <= 5 ? `#${[...color.slice(1)].map((char) => char + char).join('')}` : color
}

/** Resolve the active installed theme, its includes and user overrides like the editor. */
export async function loadScadTheme(): Promise<IRawTheme> {
    const workbench = vscode.workspace.getConfiguration('workbench')
    const selected = workbench.get<string>('colorTheme', '')
    const light = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
    let theme: { colors: Record<string, string>; rules: Rule[] } = { colors: {}, rules: [] }
    for (const extension of vscode.extensions.all) {
        const contribution = (extension.packageJSON.contributes?.themes as ThemeContribution[] | undefined)?.find((theme) => (theme.id ?? theme.label) === selected || theme.label === selected)
        if (contribution) {
            theme = await readThemeFile(resolve(extension.extensionPath, contribution.path))
            break
        }
    }
    const colorOverrides = Object.assign({}, ...scopedSettings(workbench.get<Customizations>('colorCustomizations', {}), selected)) as Record<string, string>
    const tokens = vscode.workspace.getConfiguration('editor').get<Customizations>('tokenColorCustomizations', {})
    const rules = [...theme.rules, ...scopedSettings(tokens, selected).flatMap(customRules)]
    const foreground = normalizeColor(colorOverrides['editor.foreground'] ?? theme.colors['editor.foreground']) ?? (light ? '#000000' : '#D4D4D4')
    const background = normalizeColor(colorOverrides['editor.background'] ?? theme.colors['editor.background']) ?? (light ? '#FFFFFF' : '#1E1E1E')
    return {
        name: selected,
        settings: [{ settings: { foreground, background } }, ...rules.filter((rule) => rule.scope && rule.settings).map((rule) => ({ ...rule, settings: { ...rule.settings, foreground: normalizeColor(rule.settings.foreground), background: normalizeColor(rule.settings.background) } }))],
    }
}
