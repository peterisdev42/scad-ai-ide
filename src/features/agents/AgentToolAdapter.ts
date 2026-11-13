import * as vscode from 'vscode'
import type { CapabilityDefinition } from '../../core/capabilities/CapabilityTypes'
import type { CapabilityDispatcher } from '../../core/capabilities/CapabilityDispatcher'

export class AgentToolAdapter implements vscode.LanguageModelTool<Record<string, unknown>> {
    constructor(
        private readonly definition: CapabilityDefinition,
        private readonly dispatcher: CapabilityDispatcher,
        private readonly imagePayloads?: (result: import('../../platform/cad/MeshImages').RenderResult) => Promise<Array<{ bytes: Uint8Array; mime: 'image/png' }>>,
    ) {}
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
            const images: vscode.LanguageModelDataPart[] = []
            if (this.definition.id === 'cad.modelRenderViews' && result.ok && options.input.delivery === 'inline') {
                const data = result.data as import('../../platform/cad/MeshImages').RenderResult
                if (!vscode.LanguageModelDataPart?.image || !this.imagePayloads) data.deliveryReason = 'IMAGE_API_UNAVAILABLE'
                else {
                    try {
                        for (const payload of await this.imagePayloads(data)) images.push(vscode.LanguageModelDataPart.image(payload.bytes, payload.mime))
                        if (images.length) data.delivery = 'inline'
                    } catch (error) {
                        images.length = 0
                        data.deliveryReason = error instanceof Error ? error.message.slice(0, 256) : 'IMAGE_ARTIFACT_UNAVAILABLE'
                    }
                }
                if (!images.length) data.delivery = 'metadata'
            }
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result)), ...images])
        } finally {
            subscription.dispose()
        }
    }
}
