import { pathToFileURL, fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { CapabilityError } from '../capabilities/CapabilityTypes'
import { digest } from './snapshot'
import { createVerificationReport } from './report'
import { ReportStore } from './ReportStore'
import { SharedTasks } from './SharedTasks'
import type { CadExecutionResult, CadInputs, VerificationReport } from './types'

export interface AnalyzeInput {
    uri: string
    projectRoot?: string
    mode?: 'diagnostics'
    expectedSnapshotId?: string
}
export interface VerificationHost {
    capture(uri: string, dependencies: string[], projectRoot?: string): Promise<CadInputs>
    execute(input: CadInputs, signal: AbortSignal): Promise<CadExecutionResult>
    locate(file: string): Promise<string | undefined>
}

/** Immutable evidence and verdicts; all editor and OS state arrives through injected adapters. */
export class CadVerificationService {
    readonly reports = new ReportStore()
    private readonly shared = new SharedTasks<VerificationReport>()
    private readonly dependencies = new Map<string, string[]>()
    private readonly revisions = new Map<string, number>()
    private epoch = 0
    constructor(private readonly host: VerificationHost) {}
    invalidate(uri?: string) {
        if (!uri) {
            this.epoch++
            this.shared.cancelWhere(() => true)
            return
        }
        for (const [root, deps] of this.dependencies)
            if (root === uri || deps.some((p) => pathToFileURL(p).href === uri)) {
                this.revisions.set(root, (this.revisions.get(root) ?? 0) + 1)
                this.shared.cancelWhere((key) => key.startsWith(root + '\n'))
            }
        this.revisions.set(uri, (this.revisions.get(uri) ?? 0) + 1)
        this.shared.cancelWhere((key) => key.startsWith(uri + '\n'))
        if (this.revisions.size > 256) {
            this.epoch++
            this.revisions.clear()
            this.shared.cancelWhere(() => true)
        }
    }
    async acceptExecution(inputs: CadInputs, result: CadExecutionResult): Promise<VerificationReport> {
        const uri = inputs.snapshot.document.uri
        const previous = this.dependencies.get(uri) ?? []
        const unresolved = [...inputs.snapshot.unresolvedInputs]
        if (!result.dependenciesComplete || digest([...result.dependencies].sort()) !== digest([...previous].sort())) unresolved.push('PREVIEW_DEPENDENCIES_NOT_FROZEN')
        if (result.truncated) unresolved.push('CLI_OUTPUT_TRUNCATED')
        if (result.diagnostics.some((d) => d.incomplete)) unresolved.push('CLI_INPUTS_UNRESOLVED')
        if (result.dependenciesComplete) this.dependencies.set(uri, result.dependencies)
        while (this.dependencies.size > 128) this.dependencies.delete(this.dependencies.keys().next().value!)
        const report = await createVerificationReport(inputs, result, unresolved, this.host.locate)
        return this.reports.put(report, result.log)
    }
    knownDependencies(uri: string) {
        return this.dependencies.get(uri) ?? []
    }
    async isCurrent(report: VerificationReport): Promise<boolean> {
        try {
            return (await this.host.capture(report.snapshot.document.uri, this.dependencies.get(report.snapshot.document.uri) ?? [], report.snapshot.project.rootUri)).snapshot.id === report.snapshot.id
        } catch {
            return false
        }
    }
    private async discovered(result: CadExecutionResult, input: CadInputs) {
        const paths = [...result.dependencies]
        const root = await this.host.locate(input.path)
        for (const issue of result.diagnostics) {
            if (!issue.file || ['-', '<stdin>', 'stdin', basename(input.path)].includes(issue.file)) continue
            const path = isAbsolute(issue.file) ? issue.file : resolve(dirname(input.path), issue.file)
            const uri = await this.host.locate(path)
            if (uri && uri !== root) paths.push(fileURLToPath(uri))
        }
        return [...new Set(paths)].sort()
    }
    async analyze(input: AnalyzeInput, signal?: AbortSignal): Promise<VerificationReport> {
        signal?.throwIfAborted()
        const initial = await this.host.capture(input.uri, this.dependencies.get(input.uri) ?? [], input.projectRoot)
        signal?.throwIfAborted()
        if (input.expectedSnapshotId && initial.snapshot.id !== input.expectedSnapshotId) throw new CapabilityError('SNAPSHOT_CHANGED', 'Expected snapshot is no longer current. Read the current report before retrying.', true)
        const cached = this.reports.find(initial.snapshot.id)
        if (cached && cached.executionStatus === 'SUCCEEDED' && cached.snapshot.complete) return cached
        const epoch = this.epoch,
            revision = this.revisions.get(input.uri) ?? 0
        return this.shared.run(
            `${input.uri}\n${initial.snapshot.id}:${epoch}:${revision}`,
            async (sharedSignal) => {
                const ensure = () => {
                    if (epoch !== this.epoch || revision !== (this.revisions.get(input.uri) ?? 0)) throw new CapabilityError('SNAPSHOT_CHANGED', 'Analysis is historical because inputs changed. Re-run analysis.', true)
                    sharedSignal.throwIfAborted()
                }
                let current = initial
                let result = await this.host.execute(current, sharedSignal)
                ensure()
                const discovered = await this.discovered(result, current)
                const previous = this.dependencies.get(input.uri) ?? []
                if (digest(discovered) !== digest([...previous].sort())) {
                    this.dependencies.delete(input.uri)
                    this.dependencies.set(input.uri, discovered)
                    while (this.dependencies.size > 128) this.dependencies.delete(this.dependencies.keys().next().value!)
                    current = await this.host.capture(input.uri, discovered, input.projectRoot)
                    if (current.snapshot.document.sourceSha256 !== initial.snapshot.document.sourceSha256 || current.snapshot.runtime.identityHash !== initial.snapshot.runtime.identityHash || current.snapshot.parameters.digest !== initial.snapshot.parameters.digest || current.snapshot.project.libraryEnvironmentHash !== initial.snapshot.project.libraryEnvironmentHash) throw new CapabilityError('SNAPSHOT_CHANGED', 'Inputs changed while discovering dependencies.', true)
                    result = await this.host.execute(current, sharedSignal)
                }
                ensure()
                const unresolved = [...current.snapshot.unresolvedInputs]
                if (!result.dependenciesComplete) unresolved.push('DEPENDENCIES_INCOMPLETE')
                if (digest(await this.discovered(result, current)) !== digest(discovered) && current.hasGeometry) unresolved.push('DEPENDENCIES_CHANGED_DURING_ANALYSIS')
                if (result.truncated) unresolved.push('CLI_OUTPUT_TRUNCATED')
                if (result.diagnostics.some((d) => d.incomplete)) unresolved.push('CLI_INPUTS_UNRESOLVED')
                // Completeness describes evidence, not a different compiler input identity.
                const report = await createVerificationReport(current, result, unresolved, this.host.locate)
                const latest = await this.host.capture(input.uri, this.dependencies.get(input.uri) ?? [], input.projectRoot)
                if (latest.snapshot.id !== current.snapshot.id || digest(latest.fileStamps) !== digest(current.fileStamps) || (latest.snapshot.document.version !== undefined && current.snapshot.document.version !== undefined && latest.snapshot.document.version !== current.snapshot.document.version) || epoch !== this.epoch || revision !== (this.revisions.get(input.uri) ?? 0)) throw new CapabilityError('SNAPSHOT_CHANGED', `Analysis ${report.reportId} is historical because inputs changed. Re-run analysis.`, true)
                return this.reports.put(report, result.log)
            },
            signal,
        )
    }
    dispose() {
        this.shared.dispose()
        this.reports.clear()
        this.dependencies.clear()
        this.revisions.clear()
    }
}
