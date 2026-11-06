import { randomUUID } from 'node:crypto'
import { CapabilityError, type OperationStatus } from './CapabilityTypes'

/** Awaitable operations: no detached work and no success before the handler finishes. */
export class OperationTracker {
    private readonly operations = new Map<string, { state: OperationStatus; abort: AbortController }>()
    start(capabilityId: string, signal?: AbortSignal) {
        if (this.operations.size >= 100) {
            const terminal = [...this.operations].find(([, op]) => op.state.status !== 'running')
            if (terminal) this.operations.delete(terminal[0])
            else throw new CapabilityError('BUSY', 'Too many running operations.', true)
        }
        const abort = new AbortController()
        const state: OperationStatus = { id: randomUUID(), capabilityId, status: 'running' }
        this.operations.set(state.id, { state, abort })
        const cancel = () => abort.abort()
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) abort.abort()
        return { state, signal: abort.signal, dispose: () => signal?.removeEventListener('abort', cancel) }
    }
    status(id?: string, offset = 0, limit = 20) {
        if (id) {
            const op = this.operations.get(id)
            if (!op) throw new CapabilityError('NOT_FOUND', 'Operation expired or does not exist.')
            return { ...op.state }
        }
        return { total: this.operations.size, operations: [...this.operations.values()].reverse().slice(offset, offset + limit).map(({ state }) => ({ ...state })) }
    }
    cancel(id: string) {
        const op = this.operations.get(id)
        if (!op) throw new CapabilityError('NOT_FOUND', 'Operation expired or does not exist.')
        if (op.state.status === 'running') op.abort.abort()
        return { ...op.state, cancellationRequested: op.abort.signal.aborted, message: 'Cancellation is cooperative; critical transactions finish before reporting terminal state.' }
    }
    dispose() { for (const op of this.operations.values()) op.abort.abort() }
}
