import type { LaunchCommand } from '../runtime/types'

export type CheckStatus = 'PASS' | 'FAIL' | 'UNRESOLVED' | 'SKIPPED'
export type ExecutionStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'
export type CadParameters = Record<string, string | number | boolean | number[]>
export interface CadDependency {
    uri: string
    sha256?: string
    status: 'resolved' | 'missing' | 'unreadable'
    dirty: boolean
}
export interface CadSnapshot {
    schemaVersion: 1
    id: string
    inputEvidenceHash: string
    document: { uri: string; version?: number; sourceSha256: string; dirty: boolean }
    project: { rootUri: string; libraryEnvironmentHash: string; dependencyResolutionHash?: string }
    dependencies: CadDependency[]
    runtime: { executable: string; version: string; identityHash: string; capabilityHash: string; hostPlatform: string }
    parameters: { overrides: CadParameters; digest: string }
    evaluation: { mode: 'csg' | 'full-mesh'; sourceTransport: 'stdin' | 'file'; exportFormat: 'csg' | 'stl' | '3mf' | 'png'; settingsHash: string }
    constraintsDigest: string
    kernelVersion: 'diagnostics-v1'
    complete: boolean
    unresolvedInputs: string[]
}
export interface CadIssue {
    id: string
    code: string
    title: string
    severity: 'error' | 'warning' | 'information'
    status: 'FAIL' | 'UNRESOLVED' | 'SKIPPED'
    source: 'cli'
    location?: { uri: string; line: number; character: number; confidence: 'exact' | 'fallback' }
    relatedTrace: string[]
    evidenceIds: string[]
    hint?: string
}
export interface VerificationCheck {
    id: string
    category: 'compile'
    status: CheckStatus
    required: boolean
    issueIds: string[]
    reason?: string
}
export interface VerificationReport {
    schemaVersion: 1
    reportId: string
    snapshot: CadSnapshot
    executionStatus: ExecutionStatus
    overallStatus: CheckStatus
    checks: VerificationCheck[]
    issues: CadIssue[]
    examined: string[]
    notExamined: string[]
    incomplete: string[]
    units: 'modelUnits'
    cliExitCode: number | null
    artifacts: Array<{ id: string; kind: 'log'; mimeType: 'text/plain'; snapshotId: string }>
    metrics: { elapsedMs: number; truncated: boolean }
}
export interface CadInputs {
    snapshot: CadSnapshot
    fileStamps?: Record<string, string>
    path: string
    text: string
    hasGeometry: boolean
    command: LaunchCommand
    env: NodeJS.ProcessEnv
    parameters: CadParameters
}
export interface CliDiagnostic {
    code: string
    message: string
    severity: CadIssue['severity']
    file?: string
    line?: number
    trace: string[]
    incomplete?: boolean
}
export interface CadExecutionResult {
    status: ExecutionStatus
    exitCode: number | null
    content: Buffer
    diagnostics: CliDiagnostic[]
    dependencies: string[]
    dependenciesComplete: boolean
    timings?: { meshExportMs?: number; meshReadMs?: number; dependenciesMs?: number; cleanupMs?: number }
    log: string
    truncated: boolean
    elapsedMs: number
    empty: boolean
}
