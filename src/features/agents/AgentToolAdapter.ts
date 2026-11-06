import * as vscode from 'vscode'
import type { CapabilityDefinition } from '../../core/capabilities/CapabilityTypes'
import type { CapabilityDispatcher } from '../../core/capabilities/CapabilityDispatcher'

export class AgentToolAdapter implements vscode.LanguageModelTool<Record<string, unknown>> {
    constructor(private readonly definition: CapabilityDefinition, private readonly dispatcher: CapabilityDispatcher) {}
    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, unknown>>): vscode.PreparedToolInvocation {
        const target = String(options.input.target ?? options.input.project ?? options.input.id ?? options.input.planId ?? options.input.path ?? options.input.uri ?? options.input.scope ?? '')
        return {
            invocationMessage: `${this.definition.title}${target ? `: ${target}` : ''}`,
            confirmationMessages: this.definition.risk === 'read' || (this.definition.id === 'customizer.sourceApply' && options.input.mode === 'plan') ? undefined : { title: this.definition.title, message: `${this.definition.description}\nTarget: ${target || 'See operation arguments'}` },
        }
    }
    async invoke(options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>, token: vscode.CancellationToken) {
        const abort = new AbortController()
        const subscription = token.onCancellationRequested(() => abort.abort())
        if (token.isCancellationRequested) abort.abort()
        try {
            const result = await this.dispatcher.invoke(this.definition.id, options.input, { actor: 'agent', signal: abort.signal })
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))])
        } finally { subscription.dispose() }
    }
}
