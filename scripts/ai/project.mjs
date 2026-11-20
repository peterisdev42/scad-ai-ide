import assert from 'node:assert/strict'
import { adapters, configurationId, controls, groups, namespace, reasonLabels, risks } from './metadata.mjs'

const title = { tool: 'Tools', skill: 'Skills', instruction: 'Instructions', prompt: 'Prompts', chatAgent: 'Custom agents', setting: 'Editor settings' }

export function projectCatalog(features) {
    return {
        schemaVersion: 1,
        features,
        controls,
        groups: Object.entries(groups)
            .map(([id, label], order) => ({
                id,
                label,
                order,
                ...(features.some((feature) => feature.group === id && feature.kind !== 'setting') && {
                    control: {
                        key: `${namespace}.agent.groups.${id}.enabled`,
                        label,
                        default: true,
                        scope: 'application',
                        description: `Enable Agent features in ${label}. Individual preferences are retained.`,
                    },
                }),
            }))
            .filter((group) => features.some((feature) => feature.group === group.id)),
    }
}

export function compileWhen(feature, catalog, byId) {
    const terms = new Set()
    const visited = new Set()
    const addConfig = (key) => terms.add('config.' + key)
    function gates(item) {
        if (visited.has(item.id)) return
        visited.add(item.id)
        if (item.kind !== 'setting') {
            addConfig(catalog.controls.agentEnabled.key)
            if (item.guidance) addConfig(catalog.controls.guidanceEnabled.key)
            addConfig(catalog.groups.find((group) => group.id === item.group).control.key)
            if (item.configKey) addConfig(item.configKey)
            else if (!item.control.enabledByDefault) terms.add('false')
        } else if (item.setting.type === 'boolean') addConfig(item.setting.key)
        else terms.add(`config.${item.setting.key} == '${item.setting.onValue.replaceAll("'", "\\'")}'`)
        if (item.requiresTrust) terms.add('isWorkspaceTrusted')
        for (const id of item.dependencies?.allOf ?? []) gates(byId.get(id))
    }
    gates(feature)
    return [...terms].join(' && ')
}

function toolContribution(feature) {
    const { tool, display } = feature
    // VS Code's tool parameter schema requires an object for additionalProperties.
    const inputSchema = JSON.parse(JSON.stringify(tool.inputSchema, (key, value) =>
        key === 'additionalProperties' && value === false ? { not: {} } : value))
    return {
        name: tool.name,
        displayName: display.label,
        modelDescription: tool.modelDescription,
        ...(tool.userDescription && { userDescription: tool.userDescription }),
        canBeReferencedInPrompt: true,
        toolReferenceName: tool.referenceName,
        ...(display.icon && { icon: '$(' + display.icon + ')' }),
        inputSchema,
    }
}

function settingDefinitions(catalog) {
    const settings = new Map()
    function insert(key, definition) {
        assert.ok(!settings.has(key), `Duplicate managed setting: ${key}`)
        settings.set(key, definition)
    }
    for (const { key, default: value, scope, description } of [...Object.values(catalog.controls), ...catalog.groups.flatMap((group) => group.control ?? [])]) {
        insert(key, { type: 'boolean', default: value, scope, description })
    }
    for (const feature of catalog.features) {
        if (feature.kind === 'setting') {
            const { key, type, default: value, description } = feature.setting
            insert(key, { type, ...(feature.setting.enum && { enum: feature.setting.enum }), default: value, description })
        } else if (feature.configKey)
            insert(feature.configKey, {
                type: 'boolean',
                default: feature.control.enabledByDefault,
                scope: feature.control.scope,
                description: `Enable ${feature.display.label} for the SCAD AI IDE Agent.`,
            })
    }
    return Object.fromEntries(settings)
}

export function projectContributions(manifest, catalog, byId) {
    for (const [kind, adapter] of Object.entries(adapters)) {
        if (!adapter.contribution) continue
        const entries = catalog.features
            .filter((feature) => feature.kind === kind)
            .map((feature) => ({
                ...(kind === 'tool' ? toolContribution(feature) : { path: feature.resource.path }),
                when: compileWhen(feature, catalog, byId),
            }))
        if (entries.length) manifest.contributes[adapter.contribution] = entries
        else delete manifest.contributes[adapter.contribution]
    }
    const sections = Array.isArray(manifest.contributes.configuration) ? manifest.contributes.configuration : [manifest.contributes.configuration]
    const properties = settingDefinitions(catalog)
    const managed = sections.filter((section) => section.id === configurationId)
    assert.ok(managed.length <= 1, 'Duplicate managed configuration section')
    for (const section of sections.filter((section) => section.id !== configurationId)) {
        for (const key of Object.keys(section.properties ?? {})) assert.ok(!Object.hasOwn(properties, key), `Managed setting conflicts with manual configuration: ${key}`)
    }
    const configuration = { id: configurationId, title: 'SCAD AI IDE Features', properties }
    manifest.contributes.configuration = managed.length ? sections.map((section) => (section.id === configurationId ? configuration : section)) : [...sections, configuration]
    return manifest
}

const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const string = { type: 'string' }
const boolean = { type: 'boolean' }
const dictionary = (keys, value) => object(Object.fromEntries(keys.map((key) => [key, value])))
const schema = (name, shape) => ({ $schema: 'http://json-schema.org/draft-07/schema#', $id: `https://scad-ai-ide.invalid/schema/${name}`, ...shape })
const preferenceType = (setting) => (typeof setting.default === 'boolean' ? boolean : { type: 'string', enum: setting.enum })

export function projectPanel(catalog) {
    const features = catalog.features.filter((feature) => feature.kind !== 'setting')
    const settings = catalog.features.filter((feature) => feature.kind === 'setting')
    const groups = catalog.groups.filter((group) => group.control)
    const preferences = object({
        agentEnabled: boolean,
        guidanceEnabled: boolean,
        groups: dictionary(
            groups.map((group) => group.id),
            boolean,
        ),
        features: dictionary(
            features.map((feature) => feature.id),
            boolean,
        ),
        editorAssistance: object(Object.fromEntries(settings.map((feature) => [feature.id, preferenceType(feature.setting)]))),
    })
    const runtime = object({
        id: { enum: catalog.features.map((feature) => feature.id) },
        userPreferenceEnabled: boolean,
        groupPreferenceEnabled: boolean,
        userEnabled: boolean,
        dependenciesEnabled: boolean,
        environmentAvailable: boolean,
        effectiveEnabled: boolean,
        reasonCode: string,
        reasonDetail: string,
        hostStatus: { enum: ['extension-controlled', 'external-host-state-unknown'] },
    })
    const panelState = schema('ai-panel-state', {
        ...object({
            schemaVersion: { const: 1 },
            revision: { type: 'integer', minimum: 0 },
            state: dictionary(
                catalog.features.map((feature) => feature.id),
                { $ref: '#/definitions/runtime' },
            ),
            preferences,
        }),
        definitions: { runtime },
    })
    const mutation = (action, more) => object({ action: { const: action }, ...more })
    const writableFeatures = features.filter((feature) => feature.configKey)
    const mutations = [mutation('ai.setIntegrationEnabled', { controlId: { enum: Object.keys(controls) }, enabled: boolean }), mutation('ai.applyPreferencePreset', { preset: { enum: ['defaults', 'off'] } })]
    if (groups.length) mutations.push(mutation('ai.setGroupEnabled', { groupId: { enum: groups.map((group) => group.id) }, enabled: boolean }))
    if (writableFeatures.length) mutations.push(mutation('ai.setFeatureEnabled', { featureId: { enum: writableFeatures.map((feature) => feature.id) }, enabled: boolean }))
    for (const feature of settings.filter((feature) => feature.configKey)) {
        mutations.push(mutation('ai.setSettingEnabled', { featureId: { const: feature.id }, value: preferenceType(feature.setting) }))
    }
    return {
        panelState,
        preferences: schema('ai-preferences', { oneOf: mutations }),
        layout: {
            schemaVersion: 1,
            kinds: Object.fromEntries(Object.keys(adapters).map((kind) => [kind, { label: title[kind] }])),
            sections: [
                { label: 'Integration', widget: 'Switch', source: 'controls' },
                { label: 'Overview', widget: 'ReadOnlyInfo', source: 'overview' },
                { label: 'Capabilities', widget: 'GroupSwitch', source: 'groups' },
                { label: 'Resources', widget: 'Switch', source: 'resources', description: 'VS Code controls new loads of bundled guidance. Content already included in a conversation remains in its context.' },
                { label: 'Independent editor assistance', widget: 'EnumSelect', source: 'settings', description: 'These settings apply independently of Agent integration.' },
            ],
            reasons: reasonLabels,
            risks,
        },
    }
}
