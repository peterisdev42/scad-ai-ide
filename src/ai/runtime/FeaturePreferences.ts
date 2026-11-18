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

    affects(event: vscode.ConfigurationChangeEvent) {
        const { controls, groups, features } = this.registry.catalog
        return [...Object.values(controls).map((control) => control.key), ...groups.flatMap((group) => group.control?.key ?? []), ...features.flatMap((feature) => (feature.kind === 'setting' ? feature.setting.key : (feature.configKey ?? [])))].some((key) => event.affectsConfiguration(key))
    }
}
