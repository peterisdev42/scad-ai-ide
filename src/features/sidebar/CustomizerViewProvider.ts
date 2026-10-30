import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { CustomizerService } from '../../core/customizer/CustomizerService'
import { CustomizerPresets } from './CustomizerPresets'
import type { ParameterValue } from '../../core/customizer/CustomizerParser'

/** Owns document selection and the message boundary; the view owns only presentation. */
export class CustomizerViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView
    private revision = 0
    private groupTarget?: string
    private hasGroups = false
    private allCollapsed = false
    private readonly contexts = new Map<string, boolean>()
    private loadedTarget?: string
    private loadedSource?: string
    private readonly presets: CustomizerPresets
    private presetOperations = Promise.resolve()
    private readonly subscriptions: vscode.Disposable[]

    constructor(
        readonly service: CustomizerService,
        private readonly extensionUri: vscode.Uri,
    ) {
        this.presets = new CustomizerPresets(service, () => this.refresh())
        this.subscriptions = [
            this.presets,
            service.onDidChangePreviewCapability((target) => {
                if (target === service.target) this.refresh()
            }),
            service.onDidChangeValues((target) => {
                if (target === service.target) {
                    this.refresh()
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(() => this.loadTarget()),
            vscode.window.tabGroups.onDidChangeTabs(() => this.loadTarget()),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() === service.target) {
                    this.load(event.document)
                }
            }),
            vscode.workspace.onDidOpenTextDocument(() => this.loadTarget()),
            vscode.workspace.onDidCloseTextDocument(() => this.loadTarget()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('workbench.list') || event.affectsConfiguration('workbench.experimental.modernUI')) {
                    void this.view?.webview.postMessage({ type: 'scrollSettings', settings: this.getScrollSettings() })
                }
            }),
        ]
        this.loadTarget()
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
                    this.loadTarget()
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
                    await this.presets.execute(action, typeof data.name === 'string' ? data.name : undefined)
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
                this.service.reset(name)
            } else if (data.type === 'set' && name) {
                if (data.phase === 'input' && !this.service.canPreviewContinuously()) return
                // Service validation also checks values received from untrusted webview messages.
                this.service.set(name, data.value as ParameterValue, data.phase === 'input' ? 'input' : 'commit')
            }
        } catch (error) {
            void this.view?.webview.postMessage({ type: 'error', target: this.service.target, revision: this.revision, name, message: error instanceof Error ? error.message : String(error) })
        }
    }

    private loadTarget(): void {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        const uri = input instanceof vscode.TabInputCustom && input.viewType === 'scad-ai-ide.preview.editor' ? input.uri : undefined
        const document = uri ? vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString() && !document.isClosed) : vscode.window.activeTextEditor?.document
        if (document && !document.isClosed && (document.languageId === 'openscad' || document.uri.path.toLowerCase().endsWith('.scad'))) {
            this.load(document)
        } else if (this.service.target && !vscode.workspace.textDocuments.some((document) => document.uri.toString() === this.service.target && !document.isClosed)) {
            this.service.clear()
            this.revision++
            this.refresh()
        }
    }

    private load(document: vscode.TextDocument): void {
        const target = document.uri.toString()
        const source = document.getText()
        // Focus/tab changes do not invalidate pending preset actions for unchanged source.
        if (this.service.target === target && this.loadedTarget === target && this.loadedSource === source) return
        this.loadedTarget = target
        this.loadedSource = source
        this.service.load(target, source)
        this.revision++
        this.refresh()
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
