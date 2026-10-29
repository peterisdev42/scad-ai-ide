import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { quickAccess } from '../sidebar/QuickAccessTreeProvider'
import type { registerRuntime } from '../runtime/registerRuntime'
import type { registerGitHub } from '../github/registerGitHub'
import { UserWarning } from '../../core/feedback'

export type PageId = (typeof quickAccess)[number]['id']
type RuntimeFeature = ReturnType<typeof registerRuntime>

export class PanelManager implements vscode.Disposable {
    private readonly panels = new Map<PageId, vscode.WebviewPanel>()
    private readonly changed: vscode.Disposable
    private readonly githubChanged: vscode.Disposable
    private runtimeReady = false
    private requestedRuntimeTab?: 'available'

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly runtime: RuntimeFeature,
        private readonly github: ReturnType<typeof registerGitHub>,
    ) {
        this.changed = runtime.onDidChange(() => {
            const panel = this.panels.get('runtime')
            if (panel) {
                void panel.webview.postMessage({ type: 'runtimeState', state: runtime.getState() })
            }
        })
        this.githubChanged = github.onDidChange(() => {
            for (const panel of this.panels.values()) {
                void panel.webview.postMessage({ type: 'githubState', state: github.getState() })
            }
        })
    }

    getPanel(id: PageId): vscode.WebviewPanel | undefined {
        return this.panels.get(id)
    }

    private async showRequestedRuntimeTab(panel: vscode.WebviewPanel): Promise<void> {
        if (this.runtimeReady && this.requestedRuntimeTab) {
            await panel.webview.postMessage({ type: 'runtimeTab', tab: this.requestedRuntimeTab })
            this.requestedRuntimeTab = undefined
        }
    }

    async open(id: PageId, tab?: 'available'): Promise<void> {
        if (id === 'runtime' && tab) this.requestedRuntimeTab = tab
        const existing = this.panels.get(id)
        if (existing) {
            existing.reveal()
            if (id === 'runtime') {
                await this.showRequestedRuntimeTab(existing)
                await this.runtime.loadBuilds()
            } else if (id === 'more') {
                await this.github.refresh()
            }
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
                    if (action === 'openGitHubConnection') {
                        await this.open('more')
                        return
                    }
                    if (action === 'ready') {
                        await panel.webview.postMessage({ type: 'githubState', state: this.github.getState() })
                    }
                    if (id === 'more') {
                        if (action === 'ready') {
                            await this.github.refresh()
                        } else if (action === 'connectGitHub') {
                            await vscode.commands.executeCommand('scad-ai-ide.connectGitHub')
                        }
                        return
                    }
                    if (id !== 'runtime') {
                        return
                    }
                    if (action === 'ready') {
                        this.runtimeReady = true
                        await this.showRequestedRuntimeTab(panel)
                        await panel.webview.postMessage({ type: 'runtimeState', state: this.runtime.getState() })
                        await this.runtime.loadBuilds()
                    } else if (action === 'refreshBuilds') {
                        await this.runtime.loadBuilds(true)
                    } else if (action === 'installBuild' && typeof runtimeId === 'string') {
                        await this.runtime.installBuild(Number(runtimeId))
                    } else if (action === 'refresh') {
                        await this.runtime.refresh()
                    } else if (action === 'refreshInstalled') {
                        await this.runtime.refreshInstalled()
                    } else if (action === 'installArchive') {
                        await this.runtime.installArchive()
                    } else if (action === 'browse') {
                        await this.runtime.browse()
                    } else if (action === 'deleteRuntime' && typeof runtimeId === 'string') {
                        await this.runtime.deleteRuntime(runtimeId)
                    } else if (action === 'select' && typeof runtimeId === 'string' && this.runtime.getState().runtimes.some((runtime) => runtime.id === runtimeId)) {
                        await this.runtime.select(runtimeId)
                    }
                } catch (error) {
                    await panel.webview.postMessage({ type: 'error', action, severity: error instanceof UserWarning ? 'warning' : 'error', message: error instanceof Error ? error.message : String(error) })
                } finally {
                    if (['browse', 'installArchive'].includes(String(action))) {
                        await panel.webview.postMessage({ type: 'actionComplete', action })
                    }
                }
            }),
            panel.onDidDispose(() => {
                if (id === 'runtime') {
                    this.runtimeReady = false
                    this.requestedRuntimeTab = undefined
                }
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
        this.githubChanged.dispose()
        for (const panel of [...this.panels.values()]) {
            panel.dispose()
        }
        this.panels.clear()
    }
}
