export type FeatureKind = 'tool' | 'skill' | 'instruction' | 'prompt' | 'chatAgent' | 'setting'
export type ResourceKind = Exclude<FeatureKind, 'tool' | 'setting'>
export type FeatureRisk = 'read' | 'change' | 'destructive' | 'privileged'
export type FeatureKey = `${FeatureKind}.${string}.${string}`

interface FeatureBase {
    id: FeatureKey
    group: string
    display: { label: string; summary: string; order: number; icon?: string; advanced?: boolean }
    control: { enabledByDefault: boolean; userConfigurable: boolean; scope: 'application' }
    requiresTrust?: boolean
    dependencies?: { allOf?: FeatureKey[]; recommends?: FeatureKey[] }
}

export interface ToolFeature extends FeatureBase {
    kind: 'tool'
    tool: {
        capabilityId: string
        name: string
        referenceName: string
        modelDescription: string
        userDescription?: string
        inputSchema: Record<string, unknown>
        risk: FeatureRisk
        requiresInteraction?: boolean
        safetyReview?: string
        serviceConfirmation?: true
        resultFormat?: 'inlineViews'
        availability?: 'cad' | 'cadReport' | 'pointing' | 'runtimeIdle' | 'librariesIdle' | 'customizerIdle' | 'development' | 'developmentIdle'
        service: string
        gui: string
        binding: { module: string; export: string }
    }
}

export interface ResourceFeature extends Omit<FeatureBase, 'display'> {
    kind: ResourceKind
    guidance?: boolean
    display: { order: number; label?: string; summary?: string; icon?: string; advanced?: boolean }
    resource: { path: string }
}

export interface SettingFeature extends FeatureBase {
    kind: 'setting'
    setting: { key: string; description: string } & ({ type: 'boolean'; default: boolean } | { type: 'string'; default: string; enum: string[]; onValue: string; offValue: string })
}

export type FeatureDescriptor = ToolFeature | ResourceFeature | SettingFeature
export const defineTool = (feature: ToolFeature) => feature
export const defineSkill = (feature: ResourceFeature & { kind: 'skill' }) => feature
export const defineInstruction = (feature: ResourceFeature & { kind: 'instruction' }) => feature
export const definePrompt = (feature: ResourceFeature & { kind: 'prompt' }) => feature
export const defineChatAgent = (feature: ResourceFeature & { kind: 'chatAgent' }) => feature
export const defineSetting = (feature: SettingFeature) => feature

export type NormalizedFeature = ((Omit<ToolFeature, 'tool'> & { tool: Omit<ToolFeature['tool'], 'binding'> }) | (Omit<ResourceFeature, 'display' | 'resource'> & { display: FeatureBase['display']; resource: { path: string; name: string; description: string } }) | SettingFeature) & { configKey?: string; guidance: boolean }

export type NormalizedTool = Extract<NormalizedFeature, { kind: 'tool' }>
export interface PreferenceControl {
    key: string
    label: string
    description: string
    default: boolean | string
    enum?: readonly string[]
    onValue?: string
    offValue?: string
    scope?: 'application'
}

export interface FeatureCatalog {
    schemaVersion: 1
    features: readonly NormalizedFeature[]
    groups: readonly { id: string; label: string; order: number; control?: PreferenceControl }[]
    controls: { agentEnabled: PreferenceControl; guidanceEnabled: PreferenceControl }
}
