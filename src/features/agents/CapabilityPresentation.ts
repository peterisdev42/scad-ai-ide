import { capabilityCatalog, type CapabilityRegistry } from '../../core/capabilities/CapabilityRegistry'
import resources from '../../core/capabilities/resources.json'
import { readAiPreferences } from './AgentPreferences'

/** Metadata only: observing this catalog never invokes a tool or reads private domain data. */
export function createAiPanelState(registry?: CapabilityRegistry) {
    const discovery = registry?.discover({ actor: 'agent' }, 0, capabilityCatalog.length) ?? {
        total: capabilityCatalog.length, offset: 0, hasMore: false, nextOffset: null,
        capabilities: capabilityCatalog.map((definition) => ({ ...definition, inputSchema: undefined, availability: { enabled: false, reasonCode: 'NOT_REGISTERED' } })),
    }
    const preferences = readAiPreferences()
    return {
        ...discovery,
        resources,
        preferences,
        capabilities: discovery.capabilities.map(entry => ({
            ...entry,
            availability: preferences.agentEnabled ? entry.availability : { enabled: false, reasonCode: 'DISABLED_BY_USER' },
        })),
    }
}
