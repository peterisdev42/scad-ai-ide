import { FeatureRegistry, featureCatalog } from '../ai/runtime/FeatureRegistry'
import { FeaturePolicyEngine } from '../ai/runtime/FeaturePolicyEngine'
import type { FeatureEnvironment, FeaturePreferencesSnapshot } from '../ai/contracts/FeatureState'
import { CapabilityDispatcher } from '../core/capabilities/CapabilityDispatcher'
import type { CapabilityContext } from '../core/capabilities/CapabilityTypes'

export function defaultPreferences(): FeaturePreferencesSnapshot {
    return {
        agentEnabled: true,
        guidanceEnabled: true,
        groups: Object.fromEntries(featureCatalog.groups.filter(group => group.control).map(group => [group.id, true])),
        features: Object.fromEntries(featureCatalog.features.filter(feature => feature.kind !== 'setting').map(feature => [feature.id, feature.control.enabledByDefault])),
        editorAssistance: Object.fromEntries(featureCatalog.features.flatMap(feature => feature.kind === 'setting' ? [[feature.id, feature.setting.default]] : [])),
    }
}

export function testDispatcher(
    invoke: (input: Record<string, unknown>, context: CapabilityContext) => unknown = input => input,
    read = defaultPreferences,
    environment: FeatureEnvironment = { trusted: () => true, availability: () => ({ enabled: true }) },
) {
    const registry = new FeatureRegistry(featureCatalog)
    const policy = new FeaturePolicyEngine(registry, read, environment)
    return new CapabilityDispatcher(registry, policy, (_id, input, context) => invoke(input, context))
}
