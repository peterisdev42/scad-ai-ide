import type { FeatureRegistry } from '../../ai/runtime/FeatureRegistry'
import type { FeaturePolicyEngine } from '../../ai/runtime/FeaturePolicyEngine'
import type { ToolHandler } from '../../ai/contracts/ToolServices'
import { OperationTracker } from './OperationTracker'
import { CapabilityError, type CapabilityContext } from './CapabilityTypes'

export class CapabilityDispatcher {
    private disposed = false
    onCompleted?: (capabilityId: string, operationId: string | undefined, status: string) => void
    constructor(
        private readonly registry: FeatureRegistry,
        private readonly policy: FeaturePolicyEngine,
        private readonly execute: (id: string, input: Parameters<ToolHandler>[0], context: CapabilityContext) => unknown,
        readonly operations = new OperationTracker(),
    ) {}
    dispose() {
        this.disposed = true
        this.onCompleted = undefined
        this.operations.dispose()
    }

    async invoke(capabilityId: string, input: unknown, context: CapabilityContext) {
        let operation: ReturnType<OperationTracker['start']> | undefined
        try {
            if (this.disposed) throw new CapabilityError('DISPOSED', 'Extension session ended.')
            this.policy.assertCanInvokeTool(capabilityId, context.actor)
            this.registry.validate(capabilityId, input)
            operation = this.operations.start(capabilityId, context.signal)
            if (operation.signal.aborted) throw new CapabilityError('CANCELLED', 'Operation cancelled before execution.')
            const data = await this.execute(capabilityId, input, { ...context, operationId: operation.state.id, signal: operation.signal, report: (message) => { operation!.state.message = message; context.report?.(message) } })
            // Handlers that finish a critical section successfully must report that committed outcome,
            // even if cancellation arrived during the non-cancellable section.
            operation.state.status = 'succeeded'
            return { ok: true as const, capabilityId, revision: data && typeof data === 'object' && 'revision' in data ? data.revision : undefined, data, operation: { ...operation.state } }
        } catch (error) {
            const failure = error instanceof CapabilityError ? error : new CapabilityError((error as { name?: string })?.name === 'AbortError' ? 'CANCELLED' : 'OPERATION_FAILED', error instanceof Error ? error.message : String(error), true)
            const detail = { code: failure.code, message: failure.message, retryable: failure.retryable }
            if (operation) { operation.state.status = failure.code === 'CANCELLED' ? 'cancelled' : 'failed'; operation.state.error = detail }
            return { ok: false as const, capabilityId, error: detail, operation: operation ? { ...operation.state } : null }
        } finally { operation?.dispose(); this.onCompleted?.(capabilityId, operation?.state.id, operation?.state.status ?? 'rejected') }
    }
}
