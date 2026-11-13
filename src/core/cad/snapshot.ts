import { createHash } from 'node:crypto'
import type { CadSnapshot, CheckStatus, ExecutionStatus, VerificationCheck } from './types'

export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (value && typeof value === 'object')
        return `{${Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
            .join(',')}}`
    return JSON.stringify(value) ?? 'null'
}
export function digest(value: unknown): string {
    return createHash('sha256')
        .update(typeof value === 'string' ? value : canonical(value))
        .digest('hex')
}
export function identifySnapshot(input: Omit<CadSnapshot, 'id' | 'inputEvidenceHash'>): CadSnapshot {
    const { id: _existingId, inputEvidenceHash: _existingEvidence, ...fields } = input as CadSnapshot
    const { version: _version, dirty: _dirty, ...document } = input.document
    const normalized = { ...fields, dependencies: [...input.dependencies].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)) }
    const { complete: _complete, unresolvedInputs: _unresolved, ...identity } = normalized
    return { ...normalized, inputEvidenceHash: digest([input.complete, [...input.unresolvedInputs].sort()]), id: digest({ ...identity, document }) }
}
export function verdict(execution: ExecutionStatus, checks: Array<Pick<VerificationCheck, 'required' | 'status'>>, complete: boolean): CheckStatus {
    const required = checks.filter((c) => c.required)
    if (required.some((c) => c.status === 'FAIL')) return 'FAIL'
    if (execution !== 'SUCCEEDED' || !complete || !required.length || required.some((c) => c.status === 'UNRESOLVED')) return 'UNRESOLVED'
    if (required.some((c) => c.status === 'SKIPPED')) return 'SKIPPED'
    return 'PASS'
}

/** Evidence completeness can change without changing compiler input identity. */
export function sameSnapshotEvidence(a: CadSnapshot, b: CadSnapshot): boolean {
    return a.id === b.id && a.inputEvidenceHash === b.inputEvidenceHash
}
