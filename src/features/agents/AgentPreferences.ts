import * as vscode from 'vscode'

const configuration = () => vscode.workspace.getConfiguration('scad-ai-ide')

export type AiPreferenceKey = 'agentEnabled' | 'guidanceEnabled' | 'sourceDiagnostics' | 'diagnosticsOnSave'

/** User preferences are VS Code settings, not Webview state. */
export function readAiPreferences() {
    const config = configuration()
    return {
        agentEnabled: config.get<boolean>('agent.enabled', true),
        guidanceEnabled: config.get<boolean>('agent.guidanceEnabled', true),
        sourceDiagnostics: config.get<boolean>('customizer.sourceDiagnostics', true),
        diagnosticsOnSave: config.get<string>('verification.onSave', 'off') === 'diagnostics',
    }
}

/** Separate contexts are used by static Tool and Skills/Instructions contributions. */
export async function syncAgentContexts(): Promise<void> {
    const preferences = readAiPreferences()
    await vscode.commands.executeCommand('setContext', 'scadAiAgentEnabled', preferences.agentEnabled)
    await vscode.commands.executeCommand('setContext', 'scadAiGuidanceEnabled', preferences.guidanceEnabled)
}

export function affectsAiPreferences(event: vscode.ConfigurationChangeEvent): boolean {
    return ['agent.enabled', 'agent.guidanceEnabled', 'customizer.sourceDiagnostics', 'verification.onSave']
        .some(key => event.affectsConfiguration('scad-ai-ide.' + key))
}

const fieldByPreference: Record<AiPreferenceKey, string> = {
    agentEnabled: 'agent.enabled',
    guidanceEnabled: 'agent.guidanceEnabled',
    sourceDiagnostics: 'customizer.sourceDiagnostics',
    diagnosticsOnSave: 'verification.onSave',
}

/** Strict allowlist: Webview input cannot mutate arbitrary settings. */
export async function updateAiPreference(key: unknown, checked: unknown): Promise<void> {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(fieldByPreference, key) || typeof checked !== 'boolean') {
        throw new Error('Invalid AI preference request.')
    }
    const field = fieldByPreference[key as AiPreferenceKey]
    const config = configuration()
    const value = key === 'diagnosticsOnSave' ? (checked ? 'diagnostics' : 'off') : checked
    // Respect existing workspace overrides for the independent editor assistance settings.
    const workspaceOverride = key === 'sourceDiagnostics' || key === 'diagnosticsOnSave'
        ? config.inspect(field)?.workspaceValue !== undefined
        : false
    await config.update(field, value, workspaceOverride ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global)
}
