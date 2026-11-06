import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { CustomizerService } from '../../core/customizer/CustomizerService'
import { CustomizerDomainService } from './CustomizerDomainService'
import type { ParameterValue } from '../../core/customizer/CustomizerParser'

/** Owns document selection and the message boundary; the view owns only presentation. */
export class CustomizerViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView
    private get revision() { return this.domain.revision }
    private groupTarget?: string
    private hasGroups = false
    private allCollapsed = false
    private readonly contexts = new Map<string, boolean>()
    private get presets() { return this.domain.presets }
    private presetOperations = Promise.resolve()
    private readonly subscriptions: vscode.Disposable[]

    constructor(
        readonly service: CustomizerService,
        private readonly extensionUri: vscode.Uri,
        readonly domain = new CustomizerDomainService(service),
    ) {
        this.subscriptions = [
            this.domain,
            this.domain.onDidChange(() => this.refresh()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('workbench.list') || event.affectsConfiguration('workbench.experimental.modernUI')) {
                    void this.view?.webview.postMessage({ type: 'scrollSettings', settings: this.getScrollSettings() })
                }
            }),
        ]
        this.domain.loadTarget()
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view
        const root = vscode.Uri.joinPath(this.extensionUri, 'media', 'customizer')
        const dist = vscode.Uri.joinPath(this.extensionUri, 'dist')
        view.webview.options = { enableScripts: true, localResourceRoots: [root, dist] }
        const nonce = randomBytes(16).toString('hex')
        const style = view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css'))
        const nativeStyle = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'customizer.css'))
        const icons = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'codicons', 'codicon.css'))
        const script = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'customizer.js'))
        view.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${icons}"><link rel="stylesheet" href="${nativeStyle}"><link rel="stylesheet" href="${style}"><title>Customizer</title></head>
<body><div id="scroll-host"><main aria-label="OpenSCAD Customizer"><div id="scroll-content">
<div id="panel-controls" hidden>
<div class="preset-header"><span id="preset-file" class="preset-file"></span><div class="preset-actions" role="toolbar" aria-label="Preset file actions">
<button id="preset-import" class="icon-button toolbar-button" title="Import presets" aria-label="Import presets"><span class="codicon codicon-folder-opened" aria-hidden="true"></span></button>
<button id="preset-save" class="icon-button toolbar-button" title="Save preset" aria-label="Save preset" disabled><span class="codicon codicon-save" aria-hidden="true"></span></button>
<button id="preset-more" class="icon-button toolbar-button" title="More preset actions" aria-label="More preset actions" aria-haspopup="menu" aria-controls="preset-menu" aria-expanded="false"><span class="codicon codicon-more" aria-hidden="true"></span></button>
</div></div>
<select id="preset-select" aria-label="Parameter preset" title="Apply a parameter preset to this model"><option value="">Design default</option></select>
<p id="panel-error" class="error" role="alert" hidden></p>
</div>
<p id="empty" class="message">Open an OpenSCAD file to customize its parameters.</p>
<div id="tree" role="tree" aria-label="Model parameters"></div>
<div id="status" class="sr-only" role="status" aria-live="polite"></div>
</div></main></div><div id="tooltip" role="tooltip" hidden></div>
<div id="preset-menu" class="preset-menu" role="menu" aria-label="More preset actions" hidden>
<button id="preset-new" class="preset-menu-item" role="menuitem" title="New preset" aria-label="New preset"><span class="codicon codicon-add" aria-hidden="true"></span>New preset…</button>
<button id="preset-delete" class="preset-menu-item" role="menuitem" title="Delete preset" aria-label="Delete preset" disabled><span class="codicon codicon-trash" aria-hidden="true"></span>Delete preset</button>
<button id="preset-export" class="preset-menu-item" role="menuitem" title="Export presets" aria-label="Export presets"><span class="codicon codicon-export" aria-hidden="true"></span>Export presets…</button>
</div>
<script nonce="${nonce}" src="${script}"></script></body></html>`
        this.subscriptions.push(
            view.webview.onDidReceiveMessage((message: unknown) => this.receiveMessage(message)),
            view.onDidChangeVisibility(() => {
                if (view.visible) {
                    this.domain.loadTarget()
                    this.refresh()
                }
            }),
            view.onDidDispose(() => {
                if (this.view === view) {
                    this.view = undefined
                }
            }),
        )
    }

    private receiveMessage(message: unknown): void {
        if (!message || typeof message !== 'object') {
            return
        }
        const data = message as Record<string, unknown>
        if (data.type === 'ready') {
            this.refresh()
            return
        }
        // A hidden/recreated view must never edit the previously active file.
        if (data.target !== this.service.target || data.revision !== this.revision || !this.service.target) {
            this.refresh()
            return
        }
        if (data.type === 'groups' && data.value && typeof data.value === 'object') {
            const groups = data.value as Record<string, unknown>
            this.hasGroups = groups.hasGroups === true
            this.allCollapsed = groups.allCollapsed === true
            this.updateContexts()
            return
        }
        if (data.type === 'preset') {
            const action = typeof data.action === 'string' ? data.action : ''
            this.presetOperations = this.presetOperations.then(async () => {
                if (data.target !== this.service.target || data.revision !== this.revision) return
                try {
                    await this.executePreset(action, typeof data.name === 'string' ? data.name : undefined)
                } catch (error) {
                    if (data.target === this.service.target) {
                        this.refresh()
                        void this.view?.webview.postMessage({ type: 'panelError', target: data.target, revision: this.revision, message: error instanceof Error ? error.message : String(error) })
                    }
                }
            })
            return
        }
        if (data.type !== 'set' && data.type !== 'reset') {
            return
        }
        const name = typeof data.name === 'string' ? data.name : undefined
        try {
            if (data.type === 'reset' && (name === undefined || this.service.parameters.some((parameter) => parameter.name === name))) {
                this.domain.reset(String(data.target), Number(data.revision), name)
            } else if (data.type === 'set' && name) {
                if (data.phase === 'input' && !this.service.canPreviewContinuously()) return
                // Service validation also checks values received from untrusted webview messages.
                this.service.set(name, data.value as ParameterValue, data.phase === 'input' ? 'input' : 'commit')
            }
        } catch (error) {
            void this.view?.webview.postMessage({ type: 'error', target: this.service.target, revision: this.revision, name, message: error instanceof Error ? error.message : String(error) })
        }
    }

    private async executePreset(action: string, name?: string) {
        const target = this.service.target!
        const revision = this.revision
        let uri: vscode.Uri | undefined
        if (action === 'new') name = await vscode.window.showInputBox({ prompt: 'New preset name', placeHolder: 'Preset name', validateInput: (value) => !value.trim() ? 'Enter a name' : this.presets.state().names.includes(value.trim()) ? 'A preset with this name already exists' : undefined })
        if (action === 'new' && !name) return
        if (action === 'import') uri = (await vscode.window.showOpenDialog({ filters: { 'OpenSCAD parameter files': ['json'] }, canSelectMany: false }))?.[0]
        if (action === 'export') uri = await vscode.window.showSaveDialog({ defaultUri: this.presets.state().path ? vscode.Uri.parse(this.presets.state().path!) : undefined, filters: { 'OpenSCAD parameter files': ['json'] } })
        if ((action === 'import' || action === 'export') && !uri) return
        if ((action === 'new' || action === 'save') && !this.presets.state().path && vscode.Uri.parse(target).scheme === 'untitled') uri = await vscode.window.showSaveDialog({ saveLabel: 'Create preset file', filters: { 'OpenSCAD parameter files': ['json'] } })
        await this.domain.preset(target, revision, action, name, uri)
    }

    private refresh(): void {
        const target = this.service.target
        this.presets.bind(target)
        const uri = target ? vscode.Uri.parse(target) : undefined
        if (this.groupTarget !== target) {
            this.groupTarget = target
            this.hasGroups = false
            this.allCollapsed = false
        }
        if (this.view) this.view.description = uri ? posix.parse(uri.path).name : undefined
        this.updateContexts()
        void this.view?.webview.postMessage({
            type: 'state',
            presets: this.presets.state(),
            continuousPreview: this.service.canPreviewContinuously(target),
            target,
            revision: this.revision,
            filename: uri ? posix.parse(uri.path).name : '',
            filenameTitle: uri ? vscode.workspace.asRelativePath(uri) : '',
            parameters: this.service.parameters.map((parameter) => ({ ...parameter, value: this.service.value(parameter) })),
            scrollSettings: this.getScrollSettings(),
        })
    }

    runAction(action: 'resetAll' | 'collapseAll' | 'expandAll') {
        if (!this.service.target || !this.service.parameters.length) return
        if (action === 'resetAll') return this.domain.reset(this.service.target, this.revision)
        return this.view?.webview.postMessage({ type: 'action', action, target: this.service.target, revision: this.revision })
    }

    private updateContexts() {
        const values = { hasParameters: !!this.service.parameters.length, hasGroups: this.hasGroups, allCollapsed: this.allCollapsed }
        for (const [key, value] of Object.entries(values)) {
            if (this.contexts.get(key) === value) continue
            this.contexts.set(key, value)
            void vscode.commands.executeCommand('setContext', `scad-ai-ide.customizer.${key}`, value)
        }
    }

    private getScrollSettings() {
        const resource = this.service.target ? vscode.Uri.parse(this.service.target) : undefined
        const configuration = vscode.workspace.getConfiguration('workbench', resource)
        return {
            mouseWheelScrollSensitivity: configuration.get<number>('list.mouseWheelScrollSensitivity', 1),
            fastScrollSensitivity: configuration.get<number>('list.fastScrollSensitivity', 5),
            smoothScrolling: configuration.get<boolean>('list.smoothScrolling', false),
            modernUI: configuration.get<boolean>('experimental.modernUI', false),
            // The host's Modern UI uses an 8px default; regular workbench trees use 10px.
            size: configuration.get<boolean>('experimental.modernUI', false) ? 8 : 10,
        }
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose())
    }
}
