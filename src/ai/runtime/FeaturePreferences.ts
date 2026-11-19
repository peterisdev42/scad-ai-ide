import * as vscode from 'vscode'
import { Ajv } from 'ajv'
import type { AiPreferenceMutation, FeaturePreferencesSnapshot } from '../contracts/FeatureState'
import type { FeatureRegistry } from './FeatureRegistry'
import schema from '../generated/ai-preferences.schema.json'

const namespace = 'scad-ai-ide'
const relative = (key: string) => key.slice(namespace.length + 1)
const validate = new Ajv({ strict: true, ownProperties: true }).compile<AiPreferenceMutation>(schema)

export class FeaturePreferences {
    private pending = Promise.resolve()
    constructor(private readonly registry: FeatureRegistry) {}

    read(): FeaturePreferencesSnapshot {
        const configuration = vscode.workspace.getConfiguration(namespace)
        const { controls, groups, features } = this.registry.catalog
        // Application permissions can only be narrowed by the user's application value.
        const application = (key: string, fallback: boolean): boolean => {
            const value = configuration.inspect<boolean>(relative(key))?.globalValue
            return value === undefined ? fallback : value === true
        }
        return {
            agentEnabled: application(controls.agentEnabled.key, controls.agentEnabled.default === true),
            guidanceEnabled: application(controls.guidanceEnabled.key, controls.guidanceEnabled.default === true),
            groups: Object.fromEntries(groups.flatMap(({ id, control }) => (control ? [[id, application(control.key, control.default === true)]] : []))),
            features: Object.fromEntries(features.filter((feature) => feature.kind !== 'setting').map(({ id, configKey, control }) => [id, configKey ? application(configKey, control.enabledByDefault) : control.enabledByDefault])),
            editorAssistance: Object.fromEntries(
                features.flatMap<[string, boolean | string]>((feature) => {
                    if (feature.kind !== 'setting') return []
                    const setting = feature.setting
                    const value = configuration.get<unknown>(relative(setting.key))
                    if (setting.type === 'boolean') return [[feature.id, typeof value === 'boolean' ? value : setting.default]]
                    return [[feature.id, typeof value === 'string' && setting.enum.includes(value) ? value : setting.default]]
                }),
            ),
        }
    }

    update(input: unknown): Promise<void> {
        if (!validate(input)) return Promise.reject(new Error('Invalid AI preference request.'))
        const mutation = input
        const task = this.pending.then(async () => {
            const configuration = vscode.workspace.getConfiguration(namespace)
            let key: string | undefined
            let target = vscode.ConfigurationTarget.Global
            let value: boolean | string
            switch (mutation.action) {
                case 'ai.applyPreferencePreset':
                    await this.applyPreset(mutation.preset)
                    return
                case 'ai.setIntegrationEnabled':
                    key = this.registry.catalog.controls[mutation.controlId].key
                    value = mutation.enabled
                    break
                case 'ai.setGroupEnabled':
                    key = this.registry.catalog.groups.find((group) => group.id === mutation.groupId)?.control?.key
                    value = mutation.enabled
                    break
                case 'ai.setFeatureEnabled':
                    key = this.registry.feature(mutation.featureId)?.configKey
                    value = mutation.enabled
                    break
                case 'ai.setSettingEnabled':
                    key = this.registry.feature(mutation.featureId)?.configKey
                    value = mutation.value
                    if (key && configuration.inspect(relative(key))?.workspaceValue !== undefined) target = vscode.ConfigurationTarget.Workspace
                    break
            }
            if (!key) throw new Error('Unknown AI preference.')
            await configuration.update(relative(key), value, target)
        })
        this.pending = task.catch(() => undefined)
        return task
    }

    private async applyPreset(preset: 'defaults' | 'off') {
        const { controls, groups, features } = this.registry.catalog
        const restore = preset === 'defaults'
        const groupControls = groups.flatMap((group) => group.control ?? [])
        // Disable integration first. Restore it after its individual preferences.
        const rootControls = restore ? [controls.guidanceEnabled, ...groupControls] : [...Object.values(controls), ...groupControls]
        const changes = [
            ...rootControls.map(({ key, default: value }) => ({ key, value: restore ? value : false, editor: false })),
            ...features.flatMap((feature) => {
                if (!feature.configKey) return []
                if (feature.kind !== 'setting') return [{ key: feature.configKey, value: restore && feature.control.enabledByDefault, editor: false }]
                const setting = feature.setting
                return [{ key: feature.configKey, value: restore ? setting.default : setting.type === 'boolean' ? false : setting.offValue, editor: true }]
            }),
            ...(restore ? [{ key: controls.agentEnabled.key, value: controls.agentEnabled.default, editor: false }] : []),
        ]
        const saved = this.read()
        const current = new Map<string, boolean | string>([[controls.agentEnabled.key, saved.agentEnabled], [controls.guidanceEnabled.key, saved.guidanceEnabled], ...groups.flatMap((group) => (group.control ? [[group.control.key, saved.groups[group.id]] as const] : [])), ...features.flatMap((feature) => (feature.configKey ? [[feature.configKey, feature.kind === 'setting' ? saved.editorAssistance[feature.id] : saved.features[feature.id]] as const] : []))])
        const rollback: Array<() => Promise<void>> = []
        try {
            for (const { key, value, editor } of changes) {
                if (current.get(key) === value) continue
                const field = relative(key)
                const configuration = vscode.workspace.getConfiguration(namespace)
                const inspection = configuration.inspect<boolean | string>(field)
                const workspace = editor && inspection?.workspaceValue !== undefined
                const target = workspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
                const previous = workspace ? inspection.workspaceValue : inspection?.globalValue
                await configuration.update(field, value, target)
                rollback.push(async () => {
                    const config = vscode.workspace.getConfiguration(namespace)
                    const stored = config.inspect<boolean | string>(field)
                    if ((workspace ? stored?.workspaceValue : stored?.globalValue) === value) {
                        await config.update(field, previous, target)
                    }
                })
            }
        } catch (error) {
            let rollbackFailed = false
            for (const undo of rollback.reverse()) {
                try {
                    await undo()
                } catch {
                    rollbackFailed = true
                }
            }
            if (rollbackFailed) throw new Error(`Bulk update failed and some settings could not be restored. Review the current values. ${String(error)}`)
            throw error
        }
    }

    affects(event: vscode.ConfigurationChangeEvent) {
        const { controls, groups, features } = this.registry.catalog
        return [...Object.values(controls).map((control) => control.key), ...groups.flatMap((group) => group.control?.key ?? []), ...features.flatMap((feature) => (feature.kind === 'setting' ? feature.setting.key : (feature.configKey ?? [])))].some((key) => event.affectsConfiguration(key))
    }
}
