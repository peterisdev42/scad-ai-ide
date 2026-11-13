import { randomUUID, createHash } from 'node:crypto'
import { digest, verdict } from '../cad/snapshot'
import { SharedTasks } from '../cad/SharedTasks'
import { CapabilityError } from '../capabilities/CapabilityTypes'
import type { ExecutionStatus } from '../cad/types'
import type { ArtifactRef, GeometryFacts, MeshCheck, MeshIssue, MeshReport, MeshSnapshot, VerifyMeshInput } from './types'
export interface MeshCapture {
    snapshot: MeshSnapshot
    stamps: Record<string, string>
    format: 'stl' | '3mf'
}
export interface MaterializedMesh {
    source: MeshCapture
    bytes?: Uint8Array
    empty: boolean
    executionStatus: ExecutionStatus
    checks: MeshCheck[]
    issues: MeshIssue[]
    incomplete: string[]
    log?: string
}
export interface AnalysisResult {
    executionStatus: ExecutionStatus
    facts?: GeometryFacts
    display?: { bytes: Uint8Array; maxCoordinateError: number }
    error?: { code: string; message: string; unresolved: boolean }
}
export interface MeshArtifacts {
    put(snapshotId: string, kind: ArtifactRef['kind'], mime: string, bytes: Uint8Array): Promise<ArtifactRef>
    read(id: string): Promise<Uint8Array>
    lease(ids: string[]): () => void
}
export interface MeshHost {
    capture(input: VerifyMeshInput): Promise<MeshCapture>
    materialize(source: MeshCapture, input: VerifyMeshInput, signal: AbortSignal): Promise<MaterializedMesh>
    analyze(bytes: Uint8Array, format: 'stl' | '3mf', signal: AbortSignal): Promise<AnalysisResult>
    schedule<T>(task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
}
interface Stored {
    report: MeshReport
    expires: number
    bytes: number
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
/** One authority for immutable v2 facts. Editor/CLI/worker/storage are injected. */
export class MeshVerificationService {
    private readonly tasks = new SharedTasks<MeshReport>()
    private reports = new Map<string, Stored>()
    private latest = new Map<string, string>()
    private epoch = 0
    private revisions = new Map<string, number>()
    invalidate(uri?: string) {
        if (!uri) this.epoch++
        else this.revisions.set(uri, (this.revisions.get(uri) ?? 0) + 1)
        this.tasks.cancelWhere((key) => !uri || key.startsWith(uri + '\n'))
        if (this.revisions.size > 256) {
            this.epoch++
            this.revisions.clear()
            this.tasks.cancelWhere(() => true)
        }
    }
    constructor(
        private readonly host: MeshHost,
        readonly artifacts: MeshArtifacts,
    ) {}
    private prune() {
        let size = 0
        for (const [id, entry] of this.reports) {
            if (entry.expires <= Date.now()) this.reports.delete(id)
            else size += entry.bytes
        }
        while (size > 16 * 1048576 || this.reports.size > 128) {
            const id = this.reports.keys().next().value!
            size -= this.reports.get(id)!.bytes
            this.reports.delete(id)
        }
        for (const [key, id] of this.latest) if (!this.reports.has(id)) this.latest.delete(key)
    }
    get(reportId: string) {
        this.prune()
        const report = this.reports.get(reportId)?.report
        if (!report) throw new CapabilityError('REPORT_NOT_FOUND', 'Mesh report expired or was evicted. Explicitly verify the current input.', true)
        return report
    }
    private input(report: MeshReport): VerifyMeshInput {
        return { exportSelection: report.snapshot.quality.exportSelection, uri: report.snapshot.document.uri, projectRoot: report.snapshot.project.rootUri, mode: 'verify', quality: 'verification', units: report.snapshot.units === 'mm' && report.snapshot.inputKind !== '3mf' ? 'mm' : undefined, tessellation: Object.keys(report.snapshot.quality.requestedGlobalTessellation).length ? Object.fromEntries(Object.entries(report.snapshot.quality.requestedGlobalTessellation).map(([k, v]) => [k.slice(1), v])) : undefined, requireNonEmpty: report.checks.some((c) => c.id === 'mesh-nonempty' && c.required) }
    }
    async current(report: MeshReport) {
        try {
            const now = await this.host.capture(this.input(report))
            return now.snapshot.sourceStateId === report.snapshot.sourceStateId && now.snapshot.inputEvidenceHash === report.snapshot.inputEvidenceHash
        } catch {
            return false
        }
    }
    async ensureArtifacts(report: MeshReport) {
        const release = this.artifacts.lease(report.artifacts.map((a) => a.id))
        try {
            for (const ref of report.artifacts) await this.artifacts.read(ref.id)
        } finally {
            release()
        }
    }
    private store(report: MeshReport) {
        const bytes = Buffer.byteLength(JSON.stringify(report))
        if (bytes > 16 * 1048576) throw new CapabilityError('REPORT_BUDGET_EXCEEDED', 'Mesh report exceeds the bounded evidence store; no PASS was returned.')
        const clone = structuredClone(report)
        const freeze = (value: unknown) => {
            if (value && typeof value === 'object' && !Object.isFrozen(value)) {
                Object.freeze(value)
                Object.values(value).forEach(freeze)
            }
        }
        freeze(clone)
        this.reports.set(clone.reportId, { report: clone, expires: Date.now() + 1800000, bytes })
        this.latest.set(clone.snapshot.sourceStateId, clone.reportId)
        this.prune()
        return clone
    }
    async verify(input: VerifyMeshInput, signal?: AbortSignal): Promise<MeshReport> {
        signal?.throwIfAborted()
        // Generation belongs to the completed initial capture, before any shared execution.
        // Notifications delivered while capturing may describe input already included by it.
        const initial = await this.host.capture(input)
        signal?.throwIfAborted()
        const epoch = this.epoch,
            revision = this.revisions.get(input.uri) ?? 0
        const ensureGeneration = () => {
            if (epoch !== this.epoch || revision !== (this.revisions.get(input.uri) ?? 0)) throw new CapabilityError('SNAPSHOT_CHANGED', 'Input generation changed during verification.', true)
        }
        ensureGeneration()
        signal?.throwIfAborted()
        this.prune()
        const cached = this.reports.get(this.latest.get(initial.snapshot.sourceStateId) ?? '')?.report
        if (input.expectedSnapshotId && cached?.snapshot.id !== input.expectedSnapshotId) throw new CapabilityError('SNAPSHOT_CHANGED', 'Expected geometry snapshot is no longer available/current. Verify without an expected identity.', true)
        if (cached && initial.snapshot.complete && !initial.snapshot.unresolvedInputs.length && cached.snapshot.complete && cached.facts?.complete && cached.executionStatus === 'SUCCEEDED') {
            try {
                await this.ensureArtifacts(cached)
            } catch (error) {
                this.latest.delete(initial.snapshot.sourceStateId)
                throw error
            }
            ensureGeneration()
            signal?.throwIfAborted()
            return cached
        }
        return this.tasks.run(
            `${input.uri}\n${initial.snapshot.sourceStateId}:${initial.snapshot.inputEvidenceHash}:${epoch}:${revision}`,
            (shared) =>
                this.host.schedule(async (active) => {
                    ensureGeneration()
                    const started = Date.now(),
                        result = await this.host.materialize(initial, input, active),
                        source = result.source,
                        meshHash = result.bytes ? sha(result.bytes) : undefined
                    const snapshot: MeshSnapshot = { ...source.snapshot, meshSha256: meshHash, id: digest({ source: source.snapshot.sourceStateId, meshHash, policy: source.snapshot.policyHash }) }
                    if (input.expectedSnapshotId && snapshot.id !== input.expectedSnapshotId) throw new CapabilityError('SNAPSHOT_CHANGED', 'The resulting frozen mesh differs from the expected snapshot.', true)
                    const refs: ArtifactRef[] = [],
                        releases: Array<() => void> = [],
                        issues: MeshIssue[] = result.issues.map((i) => ({ ...i, id: digest({ snapshot: snapshot.id, code: i.code, title: i.title, location: i.location }) })),
                        checks = result.checks.map((c) => ({ ...c, issueIds: c.issueIds.map((id) => issues[result.issues.findIndex((i) => i.id === id)]?.id).filter((id): id is string => !!id) })),
                        incomplete = [...source.snapshot.unresolvedInputs, ...result.incomplete]
                    let executionStatus = result.executionStatus,
                        facts: GeometryFacts | null = null
                    const addIssue = (code: string, status: 'FAIL' | 'UNRESOLVED', title: string, spatial?: MeshIssue['spatial']) => {
                        const issue: MeshIssue = { id: digest({ snapshot: snapshot.id, code, spatial }), code, status, title, severity: status === 'FAIL' ? 'error' : 'warning', source: 'mesh', location: { uri: snapshot.document.uri, line: 0, character: 0, confidence: 'fallback' }, relatedTrace: [], evidenceIds: [], spatial }
                        issues.push(issue)
                        return issue.id
                    }
                    try {
                        if (result.log) {
                            const ref = await this.artifacts.put(snapshot.id, 'log', 'text/plain', Buffer.from(result.log.slice(0, 262144)))
                            refs.push(ref)
                            releases.push(this.artifacts.lease([ref.id]))
                        }
                        if (result.bytes && result.executionStatus === 'SUCCEEDED') {
                            const ref = await this.artifacts.put(snapshot.id, 'mesh', source.format === 'stl' ? 'model/stl' : 'model/3mf', result.bytes)
                            refs.push({ ...ref, role: 'raw' })
                            releases.push(this.artifacts.lease([ref.id]))
                            const analyzed = await this.host.analyze(result.bytes, source.format, active)
                            executionStatus = analyzed.executionStatus
                            facts = analyzed.facts ?? null
                            if (analyzed.display) {
                                const displayRef = await this.artifacts.put(snapshot.id, 'mesh', 'model/stl', analyzed.display.bytes)
                                refs.push({ ...displayRef, role: 'render', derivation: { inputSha256: meshHash!, numericType: 'float32', maxCoordinateError: analyzed.display.maxCoordinateError } })
                                releases.push(this.artifacts.lease([displayRef.id]))
                            }
                            if (analyzed.error) {
                                const status = analyzed.error.unresolved ? 'UNRESOLVED' : 'FAIL',
                                    id = addIssue(analyzed.error.code, status, analyzed.error.message)
                                checks.push({ id: 'mesh-format', category: 'format', required: true, status, issueIds: [id] })
                                if (status === 'UNRESOLVED') incomplete.push(analyzed.error.code)
                            } else checks.push({ id: 'mesh-format', category: 'format', required: true, status: 'PASS', issueIds: [] })
                        } else if (result.empty && result.executionStatus === 'SUCCEEDED') {
                            facts = { algorithm: 'raw-mesh-v1', precision: 'computed-on-decoded-mesh', numericType: 'float64', topologyWeld: 'exact', objects: [], bounds: null, surfaceArea: { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' }, signedVolume: { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' }, physicalVolume: { status: 'SKIPPED', value: null, reason: 'EMPTY_MESH' }, findings: [], findingCount: 0, complete: true, pairTests: 0, elapsedMs: 0, units: snapshot.units, sourceUnit: snapshot.sourceUnit, scale: 1, rawVertices: 0, rawTriangles: 0, limitations: [] }
                        }
                        if (facts) {
                            if (snapshot.inputKind === '3mf') snapshot.sourceUnit = facts.sourceUnit
                            if (snapshot.inputKind !== '3mf') {
                                facts.units = snapshot.units
                                facts.sourceUnit = snapshot.units === 'mm' ? 'user-declared-mm' : 'undeclared'
                            }
                            const empty = facts.rawTriangles === 0
                            const ids = facts.findings.map((f) => addIssue(f.code, f.status, f.message, { instanceId: f.instanceId, triangles: f.triangles, point: f.point, triangleSamples: f.triangleSamples }))
                            const status = facts.findings.some((f) => f.status === 'FAIL') || facts.objects.some((o) => o.status === 'FAIL') ? 'FAIL' : !facts.complete ? 'UNRESOLVED' : empty ? 'SKIPPED' : 'PASS'
                            const topologyCodes = /MESH_(?:DEGENERATE|DUPLICATE|BOUNDARY|NON_MANIFOLD|INCONSISTENT|NEAR_DEGENERATE)/
                            const stages = [
                                { id: 'mesh-topology', matches: (code: string) => topologyCodes.test(code), ready: facts.complete },
                                { id: 'mesh-self-intersection', matches: (code: string) => /MESH_(?:SELF_INTERSECTION|CONTACT_UNRESOLVED)/.test(code), ready: facts.complete && !facts.objects.some((o) => o.degenerateFaces > 0) },
                                { id: 'mesh-shell-relations', matches: (code: string) => /MESH_(?:SHELL|COMPOSITION|INVERTED_WINDING|CAVITY_WINDING|VOLUME_UNRESOLVED)/.test(code), ready: facts.physicalVolume.status === 'PASS' },
                            ]
                            for (const stage of stages) {
                                const findings = issues.filter((i) => stage.matches(i.code))
                                checks.push({ id: stage.id, category: 'mesh', required: true, status: findings.some((i) => i.status === 'FAIL') ? 'FAIL' : empty ? 'SKIPPED' : findings.some((i) => i.status === 'UNRESOLVED') || !stage.ready ? 'UNRESOLVED' : 'PASS', issueIds: findings.map((i) => i.id) })
                            }
                            checks.push({ id: 'raw-mesh-validity', category: 'mesh', required: true, status, issueIds: ids, reason: 'Raw topology, bounded self-intersection and shell checks; no repair or epsilon welding.' })
                            checks.push({ id: 'physical-volume', category: 'measurement', required: true, status: facts.physicalVolume.status, issueIds: [], reason: facts.physicalVolume.reason })
                            if (!facts.complete) incomplete.push('GEOMETRY_ANALYSIS_INCOMPLETE')
                            if (input.requireNonEmpty) {
                                const id = empty ? addIssue('MESH_EXPECTED_NONEMPTY', 'FAIL', 'A non-empty model was explicitly required.') : undefined
                                checks.push({ id: 'mesh-nonempty', category: 'mesh', required: true, status: empty ? 'FAIL' : 'PASS', issueIds: id ? [id] : [] })
                            }
                            const ref = await this.artifacts.put(snapshot.id, 'analysis', 'application/json', Buffer.from(JSON.stringify(facts)))
                            refs.push(ref)
                            releases.push(this.artifacts.lease([ref.id]))
                        }
                        if (incomplete.length && !issues.some((i) => i.status === 'UNRESOLVED')) {
                            const id = addIssue('MESH_INPUTS_UNRESOLVED', 'UNRESOLVED', incomplete.join(', '))
                            checks.push({ id: 'input-completeness', category: 'format', required: true, status: 'UNRESOLVED', issueIds: [id] })
                        }
                        if (!facts && !checks.some((c) => c.status === 'FAIL' || c.status === 'UNRESOLVED')) checks.push({ id: 'mesh-analysis', category: 'mesh', required: true, status: 'UNRESOLVED', issueIds: [], reason: 'No complete mesh evidence was produced.' })
                        active.throwIfAborted()
                        const latest = await this.host.capture(input)
                        active.throwIfAborted()
                        ensureGeneration()
                        if (latest.snapshot.sourceStateId !== source.snapshot.sourceStateId || latest.snapshot.inputEvidenceHash !== source.snapshot.inputEvidenceHash || digest(latest.stamps) !== digest(source.stamps)) throw new CapabilityError('SNAPSHOT_CHANGED', 'Inputs changed during geometry verification; no current result was published.', true)
                        for (const issue of issues) issue.evidenceIds = refs.map((r) => r.id)
                        return this.store({ schemaVersion: 2, reportId: `cad-${randomUUID()}`, snapshot, executionStatus, overallStatus: verdict(executionStatus, checks, source.snapshot.complete && !incomplete.length), units: snapshot.units, checks, issues, issueCount: Math.max(issues.length, (facts?.findingCount ?? 0) + result.issues.length), facts, artifacts: refs, examined: [...(result.bytes ? ['raw-format'] : []), ...(source.snapshot.inputKind === 'scad' ? ['cli-diagnostics', ...(result.executionStatus === 'SUCCEEDED' ? ['full-render-export'] : [])] : []), ...(facts ? ['raw-topology', 'self-intersection', 'shell-relations', 'mesh-measurements'] : [])], notExamined: [...(!result.bytes ? ['raw-format'] : []), ...(!facts ? ['raw-topology', 'self-intersection', 'shell-relations', 'mesh-measurements'] : []), 'assembly', 'constraints', 'visual-inspection', 'diff', 'thickness', 'printability', 'analytic-surface-error'], incomplete: [...new Set(incomplete)], metrics: { elapsedMs: Date.now() - started, truncated: (facts?.findingCount ?? 0) > (facts?.findings.length ?? 0) }, createdAt: Date.now() })
                    } finally {
                        releases.reverse().forEach((release) => release())
                    }
                }, shared),
            signal,
        )
    }
    dispose() {
        this.tasks.dispose()
        this.reports.clear()
        this.latest.clear()
    }
}
