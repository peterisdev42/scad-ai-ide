import { randomBytes } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import * as vscode from 'vscode'
import type { registerRuntime } from '../runtime/registerRuntime'
import type { PreviewModel } from '../preview/shared/types/PreviewModel'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'
import type { CsgClipPlane, CsgScene } from '../../core/csg/types'
import { compileCsgTopology, compileMeshTopology } from '../../core/csg/compile'
import { ScadHighlighter } from './ScadHighlighter'
import { ScadModelCache } from './ScadModelCache'
import { renderScadModel } from './ScadModelRenderer'
import { loadScadTheme } from './ScadTheme'
import { renderOwnedMarkdown } from './OwnedMarkdownRenderer'

const decodeUri = (source: string) => {
    try {
        return decodeURIComponent(source)
    } catch {
        return source
    }
}
type Runtime = ReturnType<typeof registerRuntime>
interface BlockRecord {
    model: PreviewModel
    version: number
    controller?: AbortController
}

class OwnedMarkdownPreview implements vscode.Disposable {
    private readonly cache: ScadModelCache
    private readonly records = new Map<string, BlockRecord>()
    private readonly watchers = new Map<string, vscode.Disposable>()
    private readonly subscriptions: vscode.Disposable[] = []
    private readonly highlighter = new ScadHighlighter()
    private ready = false
    private disposed = false
    private timer?: ReturnType<typeof setTimeout>
    private version = 0
    private mode?: PreviewMode
    private readonly blockModes=new Map<string,PreviewMode>()
    private runtimeIdentity = ''

    constructor(
        private panel: vscode.WebviewPanel,
        private document: vscode.TextDocument,
        private context: vscode.ExtensionContext,
        private runtime: Runtime,
    ) {
        this.runtimeIdentity = JSON.stringify(runtime.getActiveRuntime()?.command ?? null)
        this.cache = new ScadModelCache(
            async (source, cwd, signal,_publish,_document,variant) => {
                await runtime.whenReady()
                signal.throwIfAborted()
                if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to run OpenSCAD.')
                const active = runtime.getActiveRuntime()
                if (!active) throw new Error('Select an OpenSCAD runtime to generate this preview.')
                // No publish callback: ordinary fast previews do not precompute topology.
                return renderScadModel(active.command, source, cwd, signal, (variant as PreviewMode)??this.renderMode)
            },
            () => this.refresh(),
        )
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'media'), vscode.Uri.file(dirname(document.uri.fsPath)), ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)] }
        panel.webview.html = this.html()
        this.subscriptions.push(
            panel.onDidDispose(() => this.dispose()),
            panel.webview.onDidReceiveMessage((message) => {
                void this.receive(message).catch((error) => console.error('Owned Markdown preview:', error))
            }),
            panel.onDidChangeViewState(() => {
                void panel.webview.postMessage({ type: 'markdownVisibility', active: panel.visible })
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length) {
                    this.document = event.document
                    this.refresh()
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('scad-ai-ide.markdown.preview')) this.invalidate()
                if (event.affectsConfiguration('editor.tokenColorCustomizations') || event.affectsConfiguration('workbench.colorTheme')) void this.theme()
            }),
            vscode.window.onDidChangeActiveColorTheme(() => {
                void this.theme()
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate()),
            runtime.onDidChange(() => {
                const active = runtime.getActiveRuntime(),
                    identity = JSON.stringify(active?.command ?? null)
                if (identity !== this.runtimeIdentity) {
                    this.runtimeIdentity = identity
                    this.invalidate()
                }
            }),
        )
        void this.highlighter
            .initialize(join(context.extensionPath, 'dist/onig.wasm'))
            .then(() => this.theme())
            .catch((error) => console.error('Owned Markdown highlighting:', error))
    }
    private get renderMode(): PreviewMode {
        return this.mode ?? vscode.workspace.getConfiguration('scad-ai-ide.markdown.preview').get<PreviewMode>('renderMode', 'render')
    }
    private async theme() {
        this.highlighter.setTheme(await loadScadTheme())
        this.refresh()
    }
    private invalidate() {
        this.cache.invalidate()
        this.refresh()
    }
    private refresh() {
        if (this.disposed || this.timer) return
        this.timer = setTimeout(() => {
            this.timer = undefined
            if (this.ready) this.render()
        }, 100)
    }
    private render() {
        const present = new Set<string>(),
            sources = new Set<string>()
        const html = renderOwnedMarkdown(
            this.document.getText(),
            (id, source) => {
                if (!vscode.workspace.getConfiguration('scad-ai-ide.markdown.preview').get<boolean>('enabled', true)) return { disabled: true, message: 'OpenSCAD Markdown previews are disabled in settings.' }
                present.add(id)
                sources.add(source)
                const state = this.cache.request(this.document.uri.toString(), source, dirname(this.document.uri.fsPath),this.blockModes.get(id)??this.renderMode),
                    previous = this.records.get(id)
                if (state.status !== 'ready') return { model: previous ? this.model(id, previous) : undefined, message: state.status === 'pending' ? 'Updating preview…' : `OpenSCAD: ${state.message}` }
                const model = JSON.parse(state.model) as PreviewModel
                let record = previous
                if (!record || record.model.content !== model.content || record.model.format !== model.format) {
                    record?.controller?.abort()
                    record = { model, version: ++this.version }
                    this.records.set(id, record)
                }
                for (const dependency of model.dependencies ?? []) this.watch(dependency.path)
                return { model: this.model(id, record) }
            },
            (source) => this.highlighter.highlight(source, (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
            (source) => {
                if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('#')) return source
                return this.panel.webview.asWebviewUri(vscode.Uri.file(resolve(dirname(this.document.uri.fsPath), decodeUri(source)))).toString()
            },
        )
        for (const [id, record] of this.records)
            if (!present.has(id)) {
                record.controller?.abort()
                this.records.delete(id)
            }
        this.cache.retainDocumentSources(this.document.uri.toString(), sources, dirname(this.document.uri.fsPath))
        const dependencies = new Set([...this.records.values()].flatMap((record) => (record.model.dependencies ?? []).map((dependency) => dependency.path)))
        for (const [path, watcher] of this.watchers)
            if (!dependencies.has(path)) {
                watcher.dispose()
                this.watchers.delete(path)
            }
        void this.panel.webview.postMessage({ type: 'markdownBody', html, mode: this.renderMode })
    }
    private model(id: string, record: BlockRecord): PreviewModel {
        return { ...record.model,previewMode:this.blockModes.get(id)??this.renderMode, host: { blockId: id, modelVersion: record.version } }
    }
    private watch(path: string) {
        if (this.watchers.has(path)) return
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(path), basename(path))),
            changed = () => {
                this.cache.invalidateResource(path)
                this.refresh()
            }
        const subscriptions = [watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed)]
        this.watchers.set(path, { dispose: () => subscriptions.forEach((s) => s.dispose()) })
    }
    private async receive(message: { type?: string; blockId?: string; modelVersion?: number; requestId?: number; planes?: CsgClipPlane[]; mode?: string; href?: string }) {
        if (this.disposed) return
        if (message.type === 'ready') {
            this.ready = true
            void this.panel.webview.postMessage({ type: 'markdownVisibility', active: this.panel.visible })
            this.render()
            return
        }
        if(message.type==='setPreviewMode'&&message.blockId&&this.records.has(message.blockId)&&(message.mode==='preview'||message.mode==='render')){
            this.blockModes.set(message.blockId,message.mode);this.refresh();return
        }
        if (message.type === 'setMarkdownMode' && (message.mode === 'preview' || message.mode === 'render')) {
            this.mode = message.mode
            this.invalidate()
            return
        }
        if (message.type === 'openLink' && typeof message.href === 'string') {
            if (/^https?:|^mailto:/i.test(message.href)) await vscode.env.openExternal(vscode.Uri.parse(message.href))
            else if (!/^[a-z][a-z\d+.-]*:/i.test(message.href)) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolve(dirname(this.document.uri.fsPath), decodeUri(message.href))))
            return
        }
        const record = message.blockId ? this.records.get(message.blockId) : undefined
        if (!record || record.version !== message.modelVersion) {
            if (message.type === 'queryTopology') void this.panel.webview.postMessage({ ...message, type: 'ownedTopology', error: 'Model changed.' })
            return
        }
        if (message.type === 'cancelTopology') {
            record.controller?.abort()
            return
        }
        if (message.type !== 'queryTopology' || !Number.isSafeInteger(message.requestId)) return
        record.controller?.abort()
        const controller = (record.controller = new AbortController())
        try {
            const geometry = record.model.format === 'csg' ? await compileCsgTopology(JSON.parse(Buffer.from(record.model.content, 'base64').toString('utf8')) as CsgScene, controller.signal, message.planes) : await compileMeshTopology(record.model.content, record.model.format, controller.signal, message.planes)
            if (!this.disposed && !controller.signal.aborted && this.records.get(message.blockId!) === record) void this.panel.webview.postMessage({ type: 'ownedTopology', blockId: message.blockId, modelVersion: record.version, requestId: message.requestId, geometry })
        } catch (error) {
            if (!this.disposed && !controller.signal.aborted) void this.panel.webview.postMessage({ type: 'ownedTopology', blockId: message.blockId, modelVersion: record.version, requestId: message.requestId, error: error instanceof Error ? error.message : String(error) })
        }
    }
    private html() {
        const webview = this.panel.webview,
            nonce = randomBytes(18).toString('base64'),
            uri = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, path)).toString()
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'nonce-${nonce}';style-src ${webview.cspSource} 'unsafe-inline';font-src ${webview.cspSource};img-src ${webview.cspSource} https: data: blob:;worker-src 'none';"><link rel="stylesheet" href="${uri('media/markdown/preview.css')}"><link rel="stylesheet" href="${uri('dist/codicons/codicon.css')}"><style>body{max-width:1000px;margin:0 auto;padding:18px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.6 var(--vscode-font-family)}header{display:flex;align-items:center;gap:12px;margin-bottom:20px}select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:4px}pre{overflow:auto;padding:12px;background:var(--vscode-textCodeBlock-background)}img{max-width:100%}[data-owned-model]:not([data-scad-model]){display:none}p[hidden]{display:none}</style></head><body><header><strong>Markdown · 3D Preview</strong></header><main id="markdown-content"></main><script nonce="${nonce}" src="${uri('media/markdown/preview.js')}"></script><script nonce="${nonce}" src="${uri('dist/markdown-owned.js')}"></script></body></html>`
    }
    reveal() {
        this.panel.reveal(vscode.ViewColumn.Beside)
    }
    dispose() {
        if (this.disposed) return
        this.disposed = true
        clearTimeout(this.timer)
        this.cache.dispose()
        for (const record of this.records.values()) record.controller?.abort()
        this.records.clear()
        for (const watcher of this.watchers.values()) watcher.dispose()
        this.highlighter.dispose()
        for (const disposable of this.subscriptions) disposable.dispose()
        this.panel.dispose()
    }
}

export function registerOwnedMarkdownPreview(context: vscode.ExtensionContext, runtime: Runtime) {
    const panels = new Map<string, OwnedMarkdownPreview>()
    context.subscriptions.push(
        vscode.commands.registerCommand('scad-ai-ide.markdown.openPreview', async (uri?: vscode.Uri) => {
            uri ??= vscode.window.activeTextEditor?.document.uri
            if (!uri || uri.scheme !== 'file' || !/\.(?:md|markdown|mdown)$/i.test(uri.path)) return
            const key = uri.toString(),
                existing = panels.get(key)
            if (existing) {
                existing.reveal()
                return
            }
            const document = await vscode.workspace.openTextDocument(uri),
                panel = vscode.window.createWebviewPanel('scad-ai-ide.markdown.preview', `3D · ${basename(uri.fsPath)}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true })
            const preview = new OwnedMarkdownPreview(panel, document, context, runtime)
            panels.set(key, preview)
            context.subscriptions.push(panel.onDidDispose(() => panels.delete(key)))
        }),
        {
            dispose: () => {
                for (const preview of panels.values()) preview.dispose()
                panels.clear()
            },
        },
    )
}
