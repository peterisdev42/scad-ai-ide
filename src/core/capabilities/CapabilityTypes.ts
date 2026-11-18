export type Actor = 'gui' | 'agent' | 'command'
export interface CapabilityContext {
    actor: Actor
    signal?: AbortSignal
    operationId?: string
    report?: (message: string) => void
}
export class CapabilityError extends Error {
    constructor(readonly code: string, message: string, readonly retryable = false) { super(message) }
}
export interface Availability { enabled: boolean; reasonCode?: string; detail?: string }
export interface OperationStatus {
    id: string
    capabilityId: string
    status: 'running' | 'succeeded' | 'failed' | 'cancelled'
    message?: string
    error?: { code: string; message: string; retryable: boolean }
}
