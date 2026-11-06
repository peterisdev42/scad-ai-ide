export type Actor = 'gui' | 'agent' | 'command'
export type CapabilityRisk = 'read' | 'change' | 'destructive' | 'privileged'
export interface CapabilityContext {
    actor: Actor
    signal?: AbortSignal
    operationId?: string
    report?: (message: string) => void
}
export class CapabilityError extends Error {
    constructor(readonly code: string, message: string, readonly retryable = false) { super(message) }
}
export interface CapabilityDefinition {
    id: string
    toolName: string
    title: string
    description: string
    risk: CapabilityRisk
    inputSchema: object
    service: string
    gui: string
}
export interface Availability { enabled: boolean; reasonCode?: string }
export interface CapabilityHandler {
    available(context: CapabilityContext): Availability
    invoke(input: Record<string, unknown>, context: CapabilityContext): Promise<unknown> | unknown
}
export interface OperationStatus {
    id: string
    capabilityId: string
    status: 'running' | 'succeeded' | 'failed' | 'cancelled'
    message?: string
    error?: { code: string; message: string; retryable: boolean }
}
