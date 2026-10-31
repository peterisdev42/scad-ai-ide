import { basename, dirname, join } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type MarkdownIt from 'markdown-it'
import { RuntimeUnavailableError } from '../../core/runtime/errors'
import type { registerRuntime } from '../runtime/registerRuntime'
import { ScadModelCache } from './ScadModelCache'
import { renderScadModel } from './ScadModelRenderer'
import type { PreviewModel } from '../preview/shared/types/PreviewModel'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'
import { ScadHighlighter } from './ScadHighlighter'
import { loadScadTheme } from './ScadTheme'

const section = 'scad-ai-ide.markdown.preview'

export function registerMarkdown(context: vscode.ExtensionContext, runtime: ReturnType<typeof registerRuntime>) {
    let disposed = false
    interface ModeRecord {token:string;document:string;source:string;cwd:string;mode?:PreviewMode;last?:PreviewModel}
    const records=new Map<string,ModeRecord>(),tokens=new Map<string,ModeRecord>()
    const recordFor=(document:string,source:string,cwd:string)=>{
        const key=JSON.stringify([document,source,cwd])
        let record=records.get(key)
        if(!record){record={document,source,cwd,token:randomUUID()};records.set(key,record);tokens.set(record.token,record)}
        while(records.size>128){const oldest=records.keys().next().value!;tokens.delete(records.get(oldest)!.token);records.delete(oldest)}
        return record
    }
    const modeFor=(record:ModeRecord)=>record.mode??vscode.workspace.getConfiguration(section).get<PreviewMode>('renderMode','render')
    const handler=vscode.window.registerUriHandler?.({handleUri(uri){
        if(disposed||uri.path!=='/markdown-mode'||!vscode.workspace.isTrusted)return
        const values=new URLSearchParams(uri.query),record=tokens.get(values.get('token')??''),mode=values.get('mode')
        if(!record||(mode!=='preview'&&mode!=='render'))return
        record.mode=mode;refresh()
    }})
    if(handler)context.subscriptions.push(handler)

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
    const resourceWatchers = new Map<string, vscode.Disposable>()
    const cache = new ScadModelCache(async (source, cwd, signal, publish,document,variant) => {
        await runtime.whenReady()
        signal.throwIfAborted()
        if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to run OpenSCAD.')
        const active = runtime.getActiveRuntime()
        if (!active) throw new RuntimeUnavailableError()
        const mode=(variant as PreviewMode)??modeFor(recordFor(document,source,cwd))
        const model = await renderScadModel(active.command, source, cwd, signal, mode, publish)
        const dependencies = JSON.parse(model).dependencies as { path: string }[] | undefined
        for (const dependency of dependencies ?? [])
            if (!resourceWatchers.has(dependency.path)) {
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(dependency.path), basename(dependency.path)))
                const changed = () => {
                    if (!cache.invalidateResource(dependency.path)) cache.invalidate()
                    refresh()
                }
                const subscriptions = [watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed)]
                resourceWatchers.set(dependency.path, { dispose: () => subscriptions.forEach((s) => s.dispose()) })
            }
        return model
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
                for (const watcher of resourceWatchers.values()) watcher.dispose()
                highlighter.dispose()
                records.clear();tokens.clear()
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
                    const record=recordFor(uri.toString(),token.content,dirname(uri.fsPath)),mode=modeFor(record)
                    const state = cache.request(uri.toString(), token.content, dirname(uri.fsPath),mode)
                    if(state.status==='ready')record.last=JSON.parse(state.model) as PreviewModel
                    const message=state.status==='pending'?'Rendering OpenSCAD…':state.status==='error'?`OpenSCAD: ${state.message}`:''
                    const base=`${vscode.env?.uriScheme??'vscode'}://${context.extension?.id??'undefined_publisher.scad-ai-ide'}/markdown-mode?token=${encodeURIComponent(record.token)}&mode=`
                    const model=record.last?{...record.last,previewMode:mode,modeLinks:{preview:base+'preview',render:base+'render'}}:undefined
                    preview=(model?`<div class="scad-markdown-viewer" data-scad-model="${escape(JSON.stringify(model))}" aria-label="Interactive OpenSCAD preview"></div>`:'')+(message?`<p class="scad-markdown-status" role="status">${escape(message)}</p>`:'')

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
