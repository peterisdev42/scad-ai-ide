import { CapabilityError, type Actor, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import type { FeatureEnvironment, FeaturePreferencesSnapshot, FeatureRuntimeState } from '../contracts/FeatureState'
import type { NormalizedFeature } from '../contracts/Feature'
import { isTool, type FeatureRegistry } from './FeatureRegistry'

export class FeaturePolicyEngine {
    constructor(
        private readonly registry: FeatureRegistry,
        private readonly readPreferences: () => FeaturePreferencesSnapshot,
        private readonly environment: FeatureEnvironment,
    ) {}

    private evaluator(preferences: FeaturePreferencesSnapshot, actor: Actor) {
        const evaluated = new Map<string, FeatureRuntimeState>()
        const evaluate = (feature: NormalizedFeature): FeatureRuntimeState => {
            const cached = evaluated.get(feature.id)
            if (cached) return cached
            const independent = feature.kind === 'setting'
            const userPreferenceEnabled = independent ? preferences.editorAssistance[feature.id] === (feature.setting.type === 'boolean' ? true : feature.setting.onValue) : preferences.features[feature.id]
            const groupPreferenceEnabled = independent || preferences.groups[feature.group]
            const gate = !independent && !preferences.agentEnabled ? 'DISABLED_GLOBAL' : feature.guidance && !preferences.guidanceEnabled ? 'DISABLED_GUIDANCE' : !groupPreferenceEnabled ? 'DISABLED_GROUP' : !userPreferenceEnabled ? 'DISABLED_FEATURE' : undefined
            const dependenciesEnabled = (feature.dependencies?.allOf ?? []).every((id) => {
                const dependency = this.registry.feature(id)
                return dependency !== undefined && evaluate(dependency).effectiveEnabled
            })
            const available = feature.requiresTrust && !this.environment.trusted() ? { enabled: false, reasonCode: 'UNTRUSTED_WORKSPACE' } : this.environment.availability(feature, actor)
            const effectiveGate = actor === 'agent' || independent ? (gate ?? (!dependenciesEnabled ? 'DISABLED_DEPENDENCY' : undefined)) : undefined
            const result: FeatureRuntimeState = {
                id: feature.id,
                userPreferenceEnabled,
                groupPreferenceEnabled,
                userEnabled: !gate,
                dependenciesEnabled,
                environmentAvailable: available.enabled,
                effectiveEnabled: !effectiveGate && available.enabled,
                reasonCode: effectiveGate ?? (available.enabled ? 'AVAILABLE' : (available.reasonCode ?? 'UNAVAILABLE')),
                reasonDetail: effectiveGate ? '' : (available.detail ?? ''),
                hostStatus: independent || isTool(feature) ? 'extension-controlled' : 'external-host-state-unknown',
            }
            evaluated.set(feature.id, result)
            return result
        }
        return evaluate
    }

    snapshot() {
        const preferences = this.readPreferences()
        const evaluate = this.evaluator(preferences, 'agent')
        const state = Object.fromEntries(this.registry.catalog.features.map((feature) => [feature.id, evaluate(feature)]))
        return { state, preferences }
    }

    assertCanInvokeTool(capabilityId: string, actor: Actor) {
        const feature = this.registry.tool(capabilityId)
        if (!feature) throw new CapabilityError('NOT_FOUND', 'Unknown capability.')
        const state = this.evaluator(this.readPreferences(), actor)(feature)
        if (!state.effectiveEnabled) throw new CapabilityError(state.reasonCode, 'Capability is unavailable in the current host/workspace.')
    }

    // The published discovery Tool keeps its original response shape and ordering.
    discover(context: CapabilityContext, offset = 0, limit = 20) {
        const tools = this.registry.catalog.features.filter(isTool)
        const next = offset + limit < tools.length ? offset + limit : null
        const evaluate = this.evaluator(this.readPreferences(), context.actor)
        return {
            total: tools.length,
            offset,
            hasMore: next !== null,
            nextOffset: next,
            capabilities: tools.slice(offset, offset + limit).map((feature) => {
                const { tool, display } = feature
                const state = evaluate(feature)
                return {
                    id: tool.capabilityId,
                    toolName: tool.name,
                    title: display.label,
                    description: tool.modelDescription,
                    requiresInteraction: tool.requiresInteraction,
                    risk: tool.risk,
                    service: tool.service,
                    gui: tool.gui,
                    availability: { enabled: state.effectiveEnabled, reasonCode: state.reasonCode === 'AVAILABLE' ? undefined : state.reasonCode, detail: state.reasonDetail || undefined },
                }
            }),
        }
    }
}
