import * as vscode from 'vscode'
import type { ToolServices } from '../contracts/ToolServices'
import type { AiPanelSnapshot } from '../contracts/FeatureState'
import type { FeaturePreferences } from './FeaturePreferences'
import type { FeaturePolicyEngine } from './FeaturePolicyEngine'
import type { FeatureRegistry } from './FeatureRegistry'
import layout from '../generated/ai-panel-layout.generated.json'

function panelCatalog({ catalog }: FeatureRegistry) {
    return {
        ...catalog,
        features: catalog.features.map(({ id, kind, group, display, dependencies, control, ...metadata }) => ({
            id,
            kind,
            group,
            display,
            dependencies,
            configurable: control.userConfigurable,
            ...('tool' in metadata && { tool: { name: metadata.tool.name, risk: metadata.tool.risk } }),
            ...('resource' in metadata && { resource: metadata.resource }),
            ...('setting' in metadata && { setting: { type: metadata.setting.type, ...(metadata.setting.type === 'string' && { enum: metadata.setting.enum }) } }),
        })),
    }
}

export class FeatureStateService implements vscode.Disposable {
    private revision = 0
    private latest?: { serialized: string; snapshot: AiPanelSnapshot }
    private emittedRevision = 0
    private pending?: ReturnType<typeof setTimeout>
    private readonly changed = new vscode.EventEmitter<AiPanelSnapshot>()
    private readonly subscriptions: vscode.Disposable[]
    readonly onDidChange = this.changed.event
    readonly staticData: { catalog: ReturnType<typeof panelCatalog>; layout: typeof layout }

    constructor(
        private readonly policy: FeaturePolicyEngine,
        private readonly preferences: FeaturePreferences,
        registry: FeatureRegistry,
        services: ToolServices,
    ) {
        this.staticData = { catalog: panelCatalog(registry), layout }
        const invalidate = () => {
            if (this.pending !== undefined) return
            this.pending = setTimeout(() => {
                this.pending = undefined
                const state = this.snapshot()
                if (state.revision === this.emittedRevision) return
                this.emittedRevision = state.revision
                this.changed.fire(state)
            }, 20)
        }
        this.subscriptions = [
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (preferences.affects(event) || event.affectsConfiguration('scad-ai-ide.verification.enabled')) invalidate()
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(invalidate),
            services.runtime.onDidChange(invalidate),
            services.libraries.onDidChange(invalidate),
            services.development.onDidChange(invalidate),
            services.customizer.onDidChange(invalidate),
            ...(services.cad ? [services.cad.onDidChangeReports(invalidate)] : []),
        ]
    }

    snapshot(): AiPanelSnapshot {
        const state = this.policy.snapshot()
        const serialized = JSON.stringify(state)
        if (this.latest?.serialized === serialized) return this.latest.snapshot
        const snapshot: AiPanelSnapshot = { schemaVersion: 1, revision: ++this.revision, ...state }
        this.latest = { serialized, snapshot }
        return snapshot
    }

    update(request: unknown) {
        return this.preferences.update(request)
    }

    dispose() {
        clearTimeout(this.pending)
        this.subscriptions.forEach((subscription) => subscription.dispose())
        this.changed.dispose()
    }
}
