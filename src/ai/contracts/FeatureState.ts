import type { Actor, Availability } from '../../core/capabilities/CapabilityTypes'
import type { FeatureCatalog, NormalizedFeature } from './Feature'
import type { FeatureId, GroupId } from '../generated/feature-ids.generated'

export interface FeaturePreferencesSnapshot {
    agentEnabled: boolean
    guidanceEnabled: boolean
    groups: Record<string, boolean>
    features: Record<string, boolean>
    editorAssistance: Record<string, boolean | string>
}

export interface FeatureEnvironment {
    trusted(): boolean
    availability(feature: NormalizedFeature, actor: Actor): Availability
}

export interface FeatureRuntimeState {
    id: string
    userPreferenceEnabled: boolean
    groupPreferenceEnabled: boolean
    userEnabled: boolean
    dependenciesEnabled: boolean
    environmentAvailable: boolean
    effectiveEnabled: boolean
    reasonCode: string
    reasonDetail: string
    hostStatus: 'extension-controlled' | 'external-host-state-unknown'
}

export interface AiPanelSnapshot {
    schemaVersion: 1
    revision: number
    state: Record<string, FeatureRuntimeState>
    preferences: FeaturePreferencesSnapshot
}

export type AiPreferenceMutation = { action: 'ai.setIntegrationEnabled'; controlId: keyof FeatureCatalog['controls']; enabled: boolean } | { action: 'ai.setGroupEnabled'; groupId: GroupId; enabled: boolean } | { action: 'ai.setFeatureEnabled'; featureId: FeatureId; enabled: boolean } | { action: 'ai.setSettingEnabled'; featureId: FeatureId; value: boolean | string }
