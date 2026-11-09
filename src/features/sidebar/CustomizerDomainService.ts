import { assertWorkspacePath } from '../../platform/WorkspacePaths'
import type { CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import * as vscode from 'vscode'
import { CustomizerService, type CustomizerChangeReason } from '../../core/customizer/CustomizerService'
import type { ParameterValue } from '../../core/customizer/CustomizerParser'
import { CustomizerPresets } from './CustomizerPresets'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { confirmCapabilityAction } from '../../platform/notifications'

/** Document binding, revision checks, atomic writes and preset orchestration, independent of any panel. */
export class CustomizerDomainService implements vscode.Disposable {
    revision = 0
    private loadedTarget?: string
    private loadedSource?: string
    readonly presets: CustomizerPresets
    private readonly changed = new vscode.EventEmitter<void>()
    readonly onDidChange = this.changed.event
    private readonly subscriptions: vscode.Disposable[]
    private busy = false
    isBusy() { return this.busy }
    constructor(readonly service: CustomizerService) {
        this.presets = new CustomizerPresets(service, () => { this.revision++; this.publish() })
        this.subscriptions = [this.presets, this.changed,
            service.onDidChangeValues(() => { this.revision++; this.publish() }),
            service.onDidChangePreviewCapability(() => this.publish()),
            vscode.window.onDidChangeActiveTextEditor(() => this.loadTarget()),
            vscode.window.tabGroups.onDidChangeTabs(() => this.loadTarget()),
            vscode.workspace.onDidChangeTextDocument((event) => { if (event.document.uri.toString() === service.target) this.load(event.document) }),
            vscode.workspace.onDidOpenTextDocument(() => this.loadTarget()),
            vscode.workspace.onDidCloseTextDocument(() => this.loadTarget()),
        ]
        this.loadTarget()
    }
    private publish() { this.presets.bind(this.service.target); this.changed.fire() }
    snapshot() {
        this.loadTarget()
        return { target: this.service.target, revision: this.revision, parameters: this.service.parameters.map((p) => ({ ...p, value: this.service.value(p) })), presets: this.presets.state(), analysis: this.service.analysisStatus, overridesEditSource: false }
    }
    assertTarget(target: string, revision: number) {
        this.loadTarget()
        if (!target || target !== this.service.target) throw new CapabilityError('TARGET_CHANGED', 'Read the active Customizer target again.', true)
        if (revision !== this.revision) throw new CapabilityError('STALE_STATE', 'Customizer changed. Read parameters again.', true)
    }
    setValues(target: string, revision: number, values: Record<string, ParameterValue>, reason: CustomizerChangeReason = 'values') {
        this.assertTarget(target, revision)
        if (this.busy) throw new CapabilityError('BUSY', 'A preset operation is already running.', true)
        try { this.service.setMany(values, reason) } catch (error) { throw new CapabilityError('INVALID_VALUE', error instanceof Error ? error.message : String(error)) }
        return this.snapshot()
    }
    reset(target: string, revision: number, name?: string) {
        this.assertTarget(target, revision)
        if (this.busy) throw new CapabilityError('BUSY', 'A preset operation is already running.', true)
        if (name && !this.service.parameters.some((p) => p.name === name)) throw new CapabilityError('INVALID_VALUE', 'Unknown parameter')
        this.service.reset(name)
        return this.snapshot()
    }
    async preset(target: string, revision: number, action: string, name?: string, uri?: vscode.Uri, context: CapabilityContext = { actor: 'gui' }) {
        this.assertTarget(target, revision)
        if (this.busy) throw new CapabilityError('BUSY', 'A preset operation is already running.', true)
        if (!this.service.analysisStatus.complete && action !== 'import') throw new CapabilityError('SOURCE_UNSUPPORTED', 'Source analysis is incomplete; finish the source before using presets.')
        this.busy = true
        try {
            if (context.actor === 'agent' && action !== 'select') {
                if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Trust the workspace to write preset files.')
                const destination = uri ?? (this.presets.state().path ? vscode.Uri.parse(this.presets.state().path!) : vscode.Uri.parse(target).with({ path: vscode.Uri.parse(target).path.replace(/\.scad$/i, '.json') }))
                if (!destination.path.toLowerCase().endsWith('.json')) throw new CapabilityError('INVALID_PATH', 'Preset files must use .json.')
                await assertWorkspacePath(destination, action !== 'import')
                this.assertTarget(target, revision)
            }
            if (action === 'delete') {
                if (!(await confirmCapabilityAction('Delete Customizer preset', `${target}: ${name ?? this.presets.state().active}`))) throw new CapabilityError('CANCELLED', 'Preset deletion cancelled.')
                this.assertTarget(target, revision)
            }
            await this.presets.execute(action, name, uri, () => this.assertTarget(target, revision))
            this.revision++
            this.publish()
            return this.snapshot()
        } finally { this.busy = false }
    }
    loadTarget(): void {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        const uri = input instanceof vscode.TabInputCustom && input.viewType === 'scad-ai-ide.preview.editor' ? input.uri : undefined
        const document = uri ? vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString() && !document.isClosed) : vscode.window.activeTextEditor?.document
        if (document && !document.isClosed && (document.languageId === 'openscad' || document.uri.path.toLowerCase().endsWith('.scad'))) {
            this.load(document)
        } else if (this.service.target && !vscode.workspace.textDocuments.some((document) => document.uri.toString() === this.service.target && !document.isClosed)) {
            this.service.clear()
            this.revision++
            this.publish()
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
        this.publish()
    }

    dispose() { this.subscriptions.forEach((s) => s.dispose()) }
}
