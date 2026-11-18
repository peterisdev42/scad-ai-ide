import * as vscode from 'vscode'
import type { ToolServices } from '../contracts/ToolServices'
import { FeatureRegistry, featureCatalog, isTool } from './FeatureRegistry'
import { FeaturePreferences } from './FeaturePreferences'
import { FeatureStateService } from './FeatureStateService'
import { ToolHostAdapter } from './ToolHostAdapter'
import { createToolRuntime } from './createToolRuntime'

export function activateFeatures(context: vscode.ExtensionContext, services: ToolServices) {
    const registry = new FeatureRegistry(featureCatalog)
    const preferences = new FeaturePreferences(registry)
    const runtime = createToolRuntime(
        registry,
        services,
        () => preferences.read(),
        () => vscode.workspace.isTrusted,
    )
    const state = new FeatureStateService(runtime.policy, preferences, registry, services)
    const output = vscode.window.createOutputChannel('SCAD AI IDE Capabilities')
    runtime.dispatcher.onCompleted = (id, operationId, status) => output.appendLine(`${id} ${operationId ?? '-'} ${status}`)
    const registrations: vscode.Disposable[] = [runtime, state, output]
    try {
        for (const feature of registry.catalog.features.filter(isTool)) {
            registrations.push(vscode.lm.registerTool(feature.tool.name, new ToolHostAdapter(feature, runtime.dispatcher, services.cad?.geometry?.imagePayloads.bind(services.cad.geometry))))
        }
    } catch (error) {
        registrations.reverse().forEach((registration) => registration.dispose())
        throw error
    }
    context.subscriptions.push(...registrations.reverse())
    return { dispatcher: runtime.dispatcher, state }
}
