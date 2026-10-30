import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import type MarkdownIt from 'markdown-it'
import { RuntimeUnavailableError } from '../../core/runtime/errors'
import type { registerRuntime } from '../runtime/registerRuntime'
import { ScadModelCache } from './ScadModelCache'
import { renderScadModel } from './ScadModelRenderer'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'
import { ScadHighlighter } from './ScadHighlighter'
import { loadScadTheme } from './ScadTheme'

const section = 'scad-ai-ide.markdown.preview'

export function registerMarkdown(context: vscode.ExtensionContext, runtime: ReturnType<typeof registerRuntime>) {
    let disposed = false
    const highlighter = new ScadHighlighter()
    const initialized = highlighter.initialize(join(context.extensionPath, 'dist', 'onig.wasm'))
    let themeGeneration = 0
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
        if (disposed || refreshTimer) return
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined
            void vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, () => {})
        }, 100)
    }
    const updateTheme = async (refreshPreview = true) => {
        const generation = ++themeGeneration
        const [, theme] = await Promise.all([initialized, loadScadTheme()])
        if (disposed || generation !== themeGeneration) return
        highlighter.setTheme(theme)
        if (refreshPreview) refresh()
    }
    const reportThemeError = (error: unknown) => console.error('OpenSCAD Markdown highlighting failed:', error)
    const ready = updateTheme(false).catch(reportThemeError)
    const cache = new ScadModelCache(async (source, cwd, signal) => {
        await runtime.whenReady()
        signal.throwIfAborted()
        if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to run OpenSCAD.')
        const active = runtime.getActiveRuntime()
        if (!active) throw new RuntimeUnavailableError()
        const mode = vscode.workspace.getConfiguration(section).get<PreviewMode>('renderMode', 'preview')
        return renderScadModel(active.command, source, cwd, signal, mode)
    }, refresh)
    const invalidate = () => {
        cache.invalidate()
        refresh()
    }
    const identity = () => {
        const active = runtime.getActiveRuntime()
        return active ? JSON.stringify({ id: active.id, version: active.version, command: active.command }) : undefined
    }
    let previousRuntime = identity()
    let wasInstalling = false
    context.subscriptions.push(
        {
            dispose() {
                disposed = true
                clearTimeout(refreshTimer)
                cache.dispose()
                highlighter.dispose()
            },
        },
        runtime.onDidChange(() => {
            const state = runtime.getState()
            wasInstalling ||= !!state.installing
            if (state.busy || state.selectingId || state.installing || state.deletingId) return
            const current = identity()
            const changed = current !== previousRuntime || (wasInstalling && !!runtime.getActiveRuntime())
            previousRuntime = current
            wasInstalling = false
            if (changed) invalidate()
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(invalidate),
        vscode.window.onDidChangeActiveColorTheme(() => {
            void updateTheme().catch(reportThemeError)
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(section)) invalidate()
            if (event.affectsConfiguration('workbench.colorTheme') || event.affectsConfiguration('workbench.colorCustomizations') || event.affectsConfiguration('editor.tokenColorCustomizations')) void updateTheme().catch(reportThemeError)
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length && event.document.languageId === 'markdown') cache.invalidate(event.document.uri.toString())
        }),
        vscode.workspace.onDidCloseTextDocument((document) => cache.invalidate(document.uri.toString())),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'openscad' || /\.(scad|stl|3mf|off|dxf|svg)$/i.test(document.uri.path)) invalidate()
        }),
    )

    return {
        ready,
        extendMarkdownIt(md: MarkdownIt): MarkdownIt {
            const originalHighlight = md.options.highlight
            md.options.highlight = (source, language, attrs) => (/^(openscad|scad)$/i.test(language) ? highlighter.highlight(source, md.utils.escapeHtml) : (originalHighlight?.(source, language, attrs) ?? md.utils.escapeHtml(source)))
            const original = md.renderer.rules.fence!
            md.renderer.rules.fence = (tokens, index, options, env: { currentDocument?: vscode.Uri }, self) => {
                const token = tokens[index]
                if (!/^(openscad|scad)$/i.test(token.info.trim().split(/\s+/)[0]) || !token.content.trim()) return original(tokens, index, options, env, self)
                const uri = env?.currentDocument
                if (!uri || uri.scheme !== 'file' || !vscode.workspace.getConfiguration(section, uri).get('enabled', true)) return original(tokens, index, options, env, self)
                const escape = md.utils.escapeHtml
                const id = `scad-${createHash('sha256').update(uri.toString()).digest('hex').slice(0, 16)}-${index}`
                // Keep Markdown scroll/double-click mapping on the always-visible container.
                // Render a copy so the cached token and other previews retain their source map.
                const sourceTokens = [...tokens]
                sourceTokens[index] = Object.assign(Object.create(Object.getPrototypeOf(token)), token, {
                    attrs:
                        token.attrs
                            ?.filter(([name]) => name !== 'data-line')
                            .map(([name, value]) => [
                                name,
                                name === 'class'
                                    ? value
                                          .split(/\s+/)
                                          .filter((name) => name !== 'code-line')
                                          .join(' ')
                                    : value,
                            ]) ?? null,
                })
                const code = original(sourceTokens, index, options, env, self)
                let preview: string
                if (!vscode.workspace.isTrusted) {
                    preview = '<p class="scad-markdown-status" role="status">Trust this workspace to render OpenSCAD code blocks.</p>'
                } else {
                    const state = cache.request(uri.toString(), token.content, dirname(uri.fsPath))
                    if (state.status === 'ready') {
                        preview = `<div class="scad-markdown-viewer" data-scad-model="${escape(state.model)}" aria-label="Interactive OpenSCAD preview"></div>`
                    } else {
                        const message = state.status === 'pending' ? 'Rendering OpenSCAD…' : `OpenSCAD: ${state.message}`
                        preview = `<p class="scad-markdown-status" role="status">${escape(message)}</p>`
                    }
                }
                const sourceMap = token.map ? ` data-line="${token.map[0]}"` : ''
                return `<div class="scad-markdown-block code-line" data-scad-block="${id}"${sourceMap}>
<div class="scad-markdown-tabs" role="tablist" aria-label="OpenSCAD">
<button type="button" id="${id}-preview-tab" role="tab" data-scad-tab="preview" aria-selected="true" aria-controls="${id}-preview" tabindex="0">Preview</button>
<button type="button" id="${id}-source-tab" role="tab" data-scad-tab="source" aria-selected="false" aria-controls="${id}-source" tabindex="-1">Source</button>
</div>
<div id="${id}-preview" class="scad-markdown-panel scad-markdown-preview" role="tabpanel" data-scad-panel="preview" aria-labelledby="${id}-preview-tab" tabindex="0">${preview}</div>
<div id="${id}-source" class="scad-markdown-panel scad-markdown-source" role="tabpanel" data-scad-panel="source" aria-labelledby="${id}-source-tab" tabindex="0" hidden>${code}</div>
</div>\n`
            }
            return md
        },
    }
}
