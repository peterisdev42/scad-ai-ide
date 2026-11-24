import { randomBytes } from 'node:crypto'
import { basename, dirname } from 'node:path'
import * as vscode from 'vscode'
import { dxfDrawingSvg } from '../../../../core/formats/dxfDrawing'
import { drawingFormat } from '../services/previewFile'

export class DrawingPreviewEditorProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(private readonly extensionUri: vscode.Uri) {}

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose() {} }
    }

    resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken): void {
        if (token.isCancellationRequested) return
        const format = drawingFormat(document.uri.path)
        const { webview } = panel
        const dist = vscode.Uri.joinPath(this.extensionUri, 'dist')
        const isPdf = format === '.pdf'
        webview.options = { enableScripts: isPdf, localResourceRoots: isPdf ? [dist] : [] }
        let generation = 0
        let disposed = false
        let ready = !isPdf
        const refresh = async () => {
            if (!ready || disposed) return
            const current = ++generation
            try {
                const bytes = await vscode.workspace.fs.readFile(document.uri)
                if (disposed || current !== generation) return
                if (isPdf) {
                    void webview.postMessage({ type: 'pdf', base64: Buffer.from(bytes).toString('base64') })
                } else {
                    const source = new TextDecoder().decode(bytes)
                    const svg = format === '.dxf' ? dxfDrawingSvg(source) : source
                    if (!/<svg[\s>]/.test(svg)) throw new Error('This export contains no SVG drawing.')
                    const image = Buffer.from(svg).toString('base64')
                    webview.html = page(`<main><img src="data:image/svg+xml;base64,${image}" alt="${format === '.dxf' ? 'DXF drawing' : 'OpenSCAD Nef debug drawing'}"></main>`)
                }
            } catch (error) {
                if (disposed || current !== generation) return
                const message = error instanceof Error ? error.message : String(error)
                if (isPdf) void webview.postMessage({ type: 'error', message })
                else webview.html = page(`<p role="alert">${escapeHtml(message)}</p>`)
            }
        }
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(document.uri.fsPath), basename(document.uri.fsPath)))
        const subscriptions = [watcher, watcher.onDidChange(refresh), watcher.onDidCreate(refresh), watcher.onDidDelete(refresh)]
        if (isPdf) {
            subscriptions.push(
                webview.onDidReceiveMessage((message: { type?: string }) => {
                    if (message.type !== 'ready') return
                    ready = true
                    void refresh()
                }),
            )
            webview.html = pdfPage(webview, dist)
        } else {
            webview.html = page('<p role="status">Loading drawing…</p>')
            void refresh()
        }
        panel.onDidDispose(() => {
            disposed = true
            subscriptions.forEach((subscription) => subscription.dispose())
        })
    }
}

function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function page(content: string, nonce = randomBytes(18).toString('base64'), scripts = ''): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; img-src data:; ${scripts}">
<style nonce="${nonce}">
body { padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
main { text-align: center; padding: 16px; }
img, canvas { max-width: 100%; height: auto; background: white; }
img { width: min(100%, 1000px); max-height: calc(100vh - 40px); object-fit: contain; }
nav { position: sticky; top: 0; padding: 8px; display: flex; align-items: center; justify-content: center; gap: 10px; background: var(--vscode-editor-background); }
button { padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button:not(:disabled):hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .55; }
p { padding: 12px; }
</style></head><body>${content}</body></html>`
}

function pdfPage(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = randomBytes(18).toString('base64')
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, name)).toString()
    return page(
        `<nav aria-label="PDF pages"><button id="previous" disabled>Previous</button><span id="position" role="status">Loading PDF…</span><button id="next" disabled>Next</button></nav>
<main><canvas id="pdf-page" aria-label="PDF page" hidden></canvas><p id="error" role="alert" hidden></p></main>
<script type="module" nonce="${nonce}" src="${asset('export-pdf.js')}" data-worker="${asset('pdf.worker.mjs')}"></script>`,
        nonce,
        `script-src 'nonce-${nonce}'; worker-src blob:; connect-src ${webview.cspSource};`,
    )
}
