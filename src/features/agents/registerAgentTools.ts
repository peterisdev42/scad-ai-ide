import * as vscode from 'vscode'
import { capabilityCatalog } from '../../core/capabilities/CapabilityRegistry'
import { AgentToolAdapter } from './AgentToolAdapter'
import { registerCapabilities, type CapabilityServices } from './registerCapabilities'

export function registerAgentTools(context: vscode.ExtensionContext, services: CapabilityServices) {
    const output = vscode.window.createOutputChannel('SCAD AI IDE Capabilities')
    context.subscriptions.push(output)
    const capabilities = registerCapabilities(services)
    capabilities.dispatcher.onCompleted = (id, operationId, status) => output.appendLine(`${id} ${operationId ?? '-'} ${status}`)
    context.subscriptions.push(capabilities, services.development)
    for (const definition of capabilityCatalog) context.subscriptions.push(vscode.lm.registerTool(definition.toolName, new AgentToolAdapter(definition, capabilities.dispatcher)))
    return capabilities.dispatcher
}
