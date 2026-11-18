import type { ToolServices } from '../contracts/ToolServices'
import type { FeatureEnvironment } from '../contracts/FeatureState'
import type { Availability } from '../../core/capabilities/CapabilityTypes'

const available: Availability = { enabled: true }
const busy: Availability = { enabled: false, reasonCode: 'BUSY' }

export function workspaceFeatureEnvironment(services: ToolServices, trusted: () => boolean): FeatureEnvironment {
    const { cad, development, runtime, libraries, customizer } = services
    return {
        trusted,
        availability(feature) {
            if (feature.kind !== 'tool') return available
            switch (feature.tool.availability) {
                case 'cad':
                case 'cadReport':
                case 'pointing':
                    if (!cad) return { enabled: false, reasonCode: 'NOT_REGISTERED' }
                    if (feature.tool.availability === 'cadReport') return available
                    if (feature.tool.availability === 'pointing' && cad.review && !cad.review.views) {
                        return { enabled: false, reasonCode: 'INTERACTION_UNAVAILABLE' }
                    }
                    return cad.geometry?.availability() ?? cad.availability()
                case 'development':
                case 'developmentIdle':
                    if (!development.enabled) return { enabled: false, reasonCode: 'DEVELOPMENT_ONLY' }
                    return feature.tool.availability === 'developmentIdle' && development.isBusy() ? busy : available
                case 'runtimeIdle': {
                    const state = runtime.getState()
                    return state.installing || state.selectingId || state.deletingId ? busy : available
                }
                case 'librariesIdle':
                    return libraries.isBusy() ? busy : available
                case 'customizerIdle':
                    return customizer.isBusy() ? busy : available
                default:
                    return available
            }
        },
    }
}
