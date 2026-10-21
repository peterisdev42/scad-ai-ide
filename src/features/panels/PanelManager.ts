import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { quickAccess } from '../sidebar/QuickAccessTreeProvider'
import type { registerRuntime } from '../runtime/registerRuntime'

export type PageId = (typeof quickAccess)[number]['id']
type RuntimeFeature = ReturnType<typeof registerRuntime>

export class PanelManager implements vscode.Disposable {
    private readonly panels = new Map<PageId, vscode.WebviewPanel>()
    private readonly changed: vscode.Disposable

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly runtime: RuntimeFeature,
    ) {
        this.changed = runtime.onDidChange(() => {
            const panel = this.panels.get('runtime')
            if (panel) {
                void panel.webview.postMessage({ type: 'runtimeState', state: runtime.getState() })
            }
        })
    }

    getPanel(id: PageId): vscode.WebviewPanel | undefined {
        return this.panels.get(id)
    }

    async open(id: PageId): Promise<void> {
        const existing = this.panels.get(id)
        if (existing) {
            existing.reveal()
            return
        }
        const page = quickAccess.find((page) => page.id === id)!
        const root = vscode.Uri.joinPath(this.extensionUri, 'media', 'panels')
        const panel = vscode.window.createWebviewPanel(`scad-ai.${id}`, page.title, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [root] })
        this.panels.set(id, panel)
        const listeners = [
            panel.webview.onDidReceiveMessage(async (value: unknown) => {
                if (!value || typeof value !== 'object') {
                    return
                }
                const { action, id: runtimeId } = value as { action?: unknown; id?: unknown }
                try {
                    if (id !== 'runtime') {
                        return
                    }
                    if (action === 'ready') {
                        await panel.webview.postMessage({ type: 'runtimeState', state: this.runtime.getState() })
                    } else if (action === 'refresh') {
                        await this.runtime.refresh()
                    } else if (action === 'browse') {
                        await this.runtime.browse()
                    } else if (action === 'automatic') {
                        await this.runtime.automatic()
                    } else if (action === 'diagnostics') {
                        this.runtime.showDiagnostics()
                    } else if (action === 'select' && typeof runtimeId === 'string' && this.runtime.getState().runtimes.some((runtime) => runtime.id === runtimeId)) {
                        await this.runtime.select(runtimeId)
                    }
                } catch (error) {
                    await panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
                }
            }),
            panel.onDidDispose(() => {
                this.panels.delete(id)
                listeners.forEach((listener) => listener.dispose())
            }),
        ]
        try {
            const source = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'index.html'))
            if (this.panels.get(id) !== panel) {
                return
            }
            const replacements: Record<string, string> = {
                csp: panel.webview.cspSource,
                nonce: randomBytes(16).toString('hex'),
                title: page.title,
                page: id,
                style: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css')).toString(),
                script: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString(),
            }
            panel.webview.html = Buffer.from(source)
                .toString('utf8')
                .replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key])
        } catch (error) {
            panel.dispose()
            throw error
        }
    }

    dispose(): void {
        this.changed.dispose()
        for (const panel of [...this.panels.values()]) {
            panel.dispose()
        }
        this.panels.clear()
    }
}
