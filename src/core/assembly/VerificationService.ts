import { randomUUID } from 'node:crypto'
import { digest, verdict } from '../cad/snapshot'
import { SharedTasks } from '../cad/SharedTasks'
import { CapabilityError } from '../capabilities/CapabilityTypes'
import type { MeshArtifacts, MeshCapture } from '../mesh/VerificationService'
import type { VerifyMeshInput, MeshReport, ArtifactRef } from '../mesh/types'
import { parseManifest, pairId } from './PartRegistry'
import { evaluate } from './constraints'
import { assemblyLimits, type AssemblyInput, type AssemblyReport, type AssemblySource, type KernelPartInput, type KernelResult, type Registry, type AssemblyIssue } from './types'
export interface FrozenPart {
    id: string
    input: VerifyMeshInput
    capture: MeshCapture
    stabilityHash: string
    inputBytes?: number
}
export interface FrozenAssembly {
    uri: string
    displayUri?: string
    text: string
    dirty: boolean
    rootUri: string
    registry: Registry
    parts: FrozenPart[]
}
export interface AssemblyHost {
    freeze(uri: string): Promise<FrozenAssembly>
    unchanged?(initial: FrozenAssembly): Promise<boolean>
    verify(input: VerifyMeshInput, signal: AbortSignal): Promise<MeshReport>
    current(report: MeshReport): Promise<boolean>
    analyze(parts: KernelPartInput[], pairs: Array<[string, string]>, signal: AbortSignal): Promise<KernelResult>
    schedule<T>(task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
}
export class AssemblyVerificationService {
    private readonly tasks = new SharedTasks<AssemblyReport>()
    private active = new Map<string, boolean>()
    private baselines = new Map<string, FrozenAssembly>()
    private refreshing = new Set<string>()
    private async unchanged(initial: FrozenAssembly, now: FrozenAssembly) {
        if (initial.registry.contentHash !== now.registry.contentHash || initial.parts.length !== now.parts.length) return false
        if (this.host.unchanged) return this.host.unchanged(initial)
        return initial.parts.every((before) => {
            const after = now.parts.find((p) => p.id === before.id)
            return !!after && before.stabilityHash === after.stabilityHash && Object.entries(before.capture.stamps).every(([k, v]) => after.capture.stamps[k] === v)
        })
    }
    refresh(scadOnly = false) {
        for (const [key, initial] of this.baselines) {
            if ((scadOnly && !this.active.get(key)) || this.refreshing.has(key)) continue
            this.refreshing.add(key)
            void this.host
                .freeze(initial.uri)
                .then(async (now) => {
                    if (this.baselines.get(key) === initial && !(await this.unchanged(initial, now))) this.tasks.cancelWhere((k) => k === key)
                })
                .catch(() => {
                    if (this.baselines.get(key) === initial) this.tasks.cancelWhere((k) => k === key)
                })
                .finally(() => this.refreshing.delete(key))
        }
    }
    invalidate(scadOnly = false) {
        this.tasks.cancelWhere((key) => !scadOnly || this.active.get(key) === true)
    }
    private reports = new Map<string, { report: AssemblyReport; bytes: number }>()
    private latest = new Map<string, string>()
    constructor(
        private readonly host: AssemblyHost,
        readonly artifacts: MeshArtifacts,
    ) {}
    private key(f: FrozenAssembly, input: AssemblyInput) {
        return digest({
            uri: f.uri,
            content: f.registry.contentHash,
            digest: f.registry.digest,
            parts: f.parts.map((p) => [p.id, p.capture.snapshot.sourceStateId, p.capture.snapshot.inputEvidenceHash]),
            pairs: input.pairIds?.slice().sort() ?? [],
            tessellation: input.tessellation ?? {},
            algorithm: 'exact-dyadic-bvh-v1',
        })
    }
    get(id: string) {
        this.prune()
        const r = this.reports.get(id)?.report
        if (!r) throw new CapabilityError('REPORT_NOT_FOUND', 'Assembly report expired or was evicted; explicitly check the current assembly.')
        return r
    }
    has(id: string) {
        this.prune()
        return this.reports.has(id)
    }
    private prune() {
        let size = 0
        for (const [id, e] of this.reports) {
            if (Date.now() - e.report.createdAt >= 1800000) this.reports.delete(id)
            else size += e.bytes
        }
        while (this.reports.size > 128 || size > 16 * 1048576) {
            const id = this.reports.keys().next().value!,
                e = this.reports.get(id)!
            size -= e.bytes
            this.reports.delete(id)
        }
        for (const [k, id] of this.latest) if (!this.reports.has(id)) this.latest.delete(k)
    }
    async ensureArtifacts(report: AssemblyReport) {
        const release = this.artifacts.lease(report.artifacts.map((a) => a.id))
        try {
            for (const a of report.artifacts) await this.artifacts.read(a.id)
        } finally {
            release()
        }
    }
    async current(report: AssemblyReport) {
        try {
            const now = await this.host.freeze(report.snapshot.document.uri)
            return (
                now.registry.contentHash === report.snapshot.document.sourceSha256 &&
                now.parts.length === report.snapshot.sources.length &&
                (await Promise.all(report.snapshot.sources.map((s) => this.host.current(s.sourceReport)))).every(Boolean)
            )
        } catch {
            return false
        }
    }
    async check(input: AssemblyInput, signal?: AbortSignal): Promise<AssemblyReport> {
        if (!!input.uri === !!input.reportId) throw new CapabilityError('INVALID_INPUT', 'Supply exactly one of uri or reportId.')
        if (input.reportId) {
            const report = this.get(input.reportId)
            await this.ensureArtifacts(report)
            return report
        }
        signal?.throwIfAborted()
        const deadline = AbortSignal.timeout(assemblyLimits.totalMs),
            caller = signal ? AbortSignal.any([signal, deadline]) : deadline
        const initial = await this.host.freeze(input.uri!)
        caller.throwIfAborted()
        if (input.expectedManifestDigest && input.expectedManifestDigest !== initial.registry.digest)
            throw new CapabilityError('CONSTRAINT_BASELINE_CHANGED', 'Manifest baseline changed. Read and approve the new baseline before continuing the repair.')
        const key = this.key(initial, input),
            cached = this.reports.get(this.latest.get(key) ?? '')?.report
        if (input.expectedSnapshotId && cached?.snapshot.id !== input.expectedSnapshotId)
            throw new CapabilityError('SNAPSHOT_CHANGED', 'Expected assembly snapshot is not available/current.', true)
        if (cached && (await this.current(cached))) {
            await this.ensureArtifacts(cached)
            caller.throwIfAborted()
            return cached
        }
        return this.tasks.run(
            key,
            (shared) => {
                this.baselines.set(key, initial)
                this.active.set(
                    key,
                    initial.parts.some((p) => p.capture.snapshot.runtime.used),
                )
                return this.host
                    .schedule(async (active) => {
                        const stop = AbortSignal.any([active, AbortSignal.timeout(assemblyLimits.totalMs)]),
                            manifest = initial.registry.manifest,
                            sources: AssemblySource[] = [],
                            releases: Array<() => void> = [],
                            refs: ArtifactRef[] = [],
                            incomplete: string[] = [],
                            issues: AssemblyIssue[] = []
                        let facts: KernelResult | null = null
                        try {
                            if (manifest) {
                                const requests = new Map<string, [string, string]>()
                                for (const r of manifest.checks) if ('parts' in r) requests.set(pairId(...r.parts), [...r.parts].sort() as [string, string])
                                for (const id of input.pairIds ?? []) {
                                    let found = false
                                    for (let a = 0; a < manifest.parts.length; a++)
                                        for (let b = a + 1; b < manifest.parts.length; b++) {
                                            const ids: [string, string] = [manifest.parts[a].id, manifest.parts[b].id].sort() as [string, string]
                                            if (pairId(...ids) === id) {
                                                requests.set(id, ids)
                                                found = true
                                            }
                                        }
                                    if (!found) throw new CapabilityError('PAIR_NOT_FOUND', 'Additional pairId is not a declared part pair.')
                                }
                                if (requests.size > assemblyLimits.pairs) throw new CapabilityError('ASSEMBLY_PAIR_BUDGET', 'Too many requested pairs.')
                                const kernelInputs: KernelPartInput[] = [],
                                    seen = new Set<string>()
                                let byteCount = 0
                                let vertices = 0,
                                    triangles = 0
                                for (const p of initial.parts) {
                                    const hash = p.capture.snapshot.document.sourceSha256
                                    if (!seen.has(hash)) {
                                        seen.add(hash)
                                        byteCount += p.inputBytes ?? 0
                                    }
                                }
                                // All entries were captured before the first export; each export keeps its own dependency discovery.
                                for (const p of initial.parts) {
                                    stop.throwIfAborted()
                                    const def = manifest.parts.find((d) => d.id === p.id)!,
                                        sourceReport = await this.host.verify(
                                            { ...p.input, tessellation: /\.(scad|csg)$/i.test(p.input.uri) ? input.tessellation : undefined },
                                            stop,
                                        )
                                    sources.push({ partId: p.id, uri: p.input.uri, selector: def.selector, sourceReport, transform: def.transform })
                                    releases.push(this.artifacts.lease(sourceReport.artifacts.map((a) => a.id)))
                                    for (const ref of sourceReport.artifacts) if (!refs.some((a) => a.id === ref.id)) refs.push(ref)
                                    if (sourceReport.overallStatus !== 'PASS') {
                                        incomplete.push(`PART_PREREQUISITES:${p.id}`)
                                        continue
                                    }
                                    const raw = sourceReport.artifacts.find((a) => a.role === 'raw')
                                    if (!raw) {
                                        incomplete.push(`PART_ARTIFACT_MISSING:${p.id}`)
                                        continue
                                    }
                                    if (!seen.has(raw.sha256)) {
                                        seen.add(raw.sha256)
                                        byteCount += raw.bytes
                                    }
                                    if (byteCount > assemblyLimits.inputBytes) {
                                        incomplete.push('ASSEMBLY_INPUT_BUDGET')
                                        break
                                    }
                                    vertices += sourceReport.facts?.rawVertices ?? 0
                                    triangles += sourceReport.facts?.rawTriangles ?? 0
                                    if (vertices > assemblyLimits.vertices || triangles > assemblyLimits.triangles) {
                                        incomplete.push('ASSEMBLY_GEOMETRY_BUDGET')
                                        break
                                    }
                                    kernelInputs.push({
                                        id: p.id,
                                        bytes: await this.artifacts.read(raw.id),
                                        format: raw.mimeType === 'model/3mf' ? '3mf' : 'stl',
                                        transform: def.transform,
                                    })
                                }
                                facts = await this.host.analyze(kernelInputs, [...requests.values()], stop)
                                incomplete.push(...facts.incomplete)
                            }
                            const final = await this.host.freeze(initial.uri)
                            stop.throwIfAborted()
                            if (input.expectedManifestDigest && input.expectedManifestDigest !== final.registry.digest)
                                throw new CapabilityError('CONSTRAINT_BASELINE_CHANGED', 'Manifest baseline changed while checking. No current result was published.')
                            if (initial.registry.contentHash !== final.registry.contentHash || initial.parts.length !== final.parts.length)
                                throw new CapabilityError('SNAPSHOT_CHANGED', 'Assembly inputs changed during verification.', true)
                            if (!(await this.unchanged(initial, final)))
                                throw new CapabilityError('SNAPSHOT_CHANGED', 'A frozen assembly input changed before the complete result was ready.', true)
                            if (!(await Promise.all(sources.map((s) => this.host.current(s.sourceReport)))).every(Boolean))
                                throw new CapabilityError('SNAPSHOT_CHANGED', 'A part became historical during assembly verification.', true)
                            const snapshotId = digest({
                                    manifest: initial.registry.contentHash,
                                    uri: initial.uri,
                                    sources: sources.map((s) => [s.partId, s.sourceReport.snapshot.id, s.selector, s.transform]),
                                    requirements: key,
                                }),
                                checks = manifest
                                    ? evaluate(manifest, facts)
                                    : [
                                          {
                                              id: 'manifest',
                                              required: true,
                                              status: 'UNRESOLVED' as const,
                                              reason: initial.registry.issues[0]?.code ?? 'NO_STABLE_PARTS',
                                              issueIds: [] as string[],
                                          },
                                      ]
                            if (input.expectedSnapshotId && snapshotId !== input.expectedSnapshotId)
                                throw new CapabilityError('SNAPSHOT_CHANGED', 'Frozen assembly differs from expected snapshot.', true)
                            for (const s of sources)
                                if (s.sourceReport.overallStatus !== 'PASS') {
                                    const c = checks.find((c) => c.id === `part:${s.partId}:solid`)!
                                    c.status = s.sourceReport.overallStatus === 'FAIL' ? 'FAIL' : 'UNRESOLVED'
                                    c.reason = s.sourceReport.incomplete.join(', ') || 'SOURCE_VERIFICATION_FAILED'
                                }
                            const locate = (offset: number) => {
                                const prefix = initial.text.slice(0, offset),
                                    lines = prefix.split('\n')
                                return { uri: initial.displayUri ?? initial.uri, line: lines.length - 1, character: lines.at(-1)!.length, confidence: 'exact' as const }
                            }
                            const issue = (code: string, title: string, status: 'FAIL' | 'UNRESOLVED', offset = 0, extras: Partial<AssemblyIssue> = {}) => {
                                const i: AssemblyIssue = {
                                    id: digest([snapshotId, code, extras.pairId, extras.partIds, title]),
                                    code,
                                    title,
                                    status,
                                    source: 'assembly',
                                    severity: status === 'FAIL' ? 'error' : 'warning',
                                    location: locate(offset),
                                    relatedTrace: [],
                                    evidenceIds: [],
                                    ...extras,
                                }
                                issues.push(i)
                                return i.id
                            }
                            if (!manifest) {
                                for (const i of initial.registry.issues) {
                                    checks[0].status = i.code === 'NO_STABLE_PARTS' ? 'UNRESOLVED' : 'FAIL'
                                    checks[0].issueIds.push(
                                        issue(i.code, i.message, checks[0].status as 'FAIL' | 'UNRESOLVED', i.offset, { source: 'manifest', pointer: i.pointer }),
                                    )
                                }
                                if (!initial.registry.issues.length) checks[0].issueIds.push(issue('NO_STABLE_PARTS', 'No stable parts declared.', 'UNRESOLVED'))
                            } else
                                for (const c of checks)
                                    if (c.status === 'FAIL' || c.status === 'UNRESOLVED') {
                                        const index = manifest.checks.findIndex((r) => r.id === c.id),
                                            rule = manifest.checks[index],
                                            offset =
                                                index < 0
                                                    ? jsonOffset(initial.text, `/parts/${manifest.parts.findIndex((p) => p.id === c.id.split(':')[1])}`)
                                                    : jsonOffset(initial.text, `/checks/${index}`),
                                            spatial = c.pairId ? facts?.pairs.find((p) => p.pairId === c.pairId) : undefined
                                        c.issueIds.push(
                                            issue(
                                                c.id.startsWith('part:')
                                                    ? 'PART_SOLID_INVALID'
                                                    : c.status === 'FAIL'
                                                      ? 'ASSEMBLY_CONSTRAINT_FAILED'
                                                      : 'ASSEMBLY_CONSTRAINT_UNRESOLVED',
                                                `${c.id}: ${c.reason ?? c.relation ?? c.status}`,
                                                c.status,
                                                offset,
                                                {
                                                    source: 'constraints',
                                                    pairId: c.pairId,
                                                    partIds: rule ? ('parts' in rule ? rule.parts : [rule.part]) : [c.id.split(':')[1]],
                                                    pointer: index < 0 ? '/parts' : `/checks/${index}`,
                                                    spatial,
                                                },
                                            ),
                                        )
                                    }
                            for (const source of sources) {
                                const c = checks.find((c) => c.id === `part:${source.partId}:solid`)
                                for (const origin of source.sourceReport.issues.slice(0, 32)) {
                                    if (origin.status !== 'FAIL' && origin.status !== 'UNRESOLVED') continue
                                    const id = issue(origin.code, origin.title, origin.status, 0, {
                                        source: origin.source,
                                        location: origin.location ?? { uri: source.uri, line: 0, character: 0, confidence: 'fallback' },
                                        partIds: [source.partId],
                                        relatedTrace: origin.relatedTrace,
                                        spatial: origin.spatial,
                                    })
                                    c?.issueIds.push(id)
                                }
                            }
                            if (facts?.worldMesh) {
                                const ref = await this.artifacts.put(snapshotId, 'mesh', 'application/vnd.scad-ai-ide.world-mesh', facts.worldMesh)
                                refs.push(ref)
                                releases.push(this.artifacts.lease([ref.id]))
                                if (facts.display) {
                                    const render = await this.artifacts.put(snapshotId, 'mesh', 'model/stl', facts.display.bytes)
                                    refs.push({
                                        ...render,
                                        role: 'render',
                                        derivation: { inputSha256: ref.sha256, numericType: 'float32', maxCoordinateError: facts.display.maxCoordinateError },
                                    })
                                    releases.push(this.artifacts.lease([render.id]))
                                }
                            }
                            if (facts) {
                                facts = { ...facts, worldMesh: undefined, display: undefined }
                                const ref = await this.artifacts.put(snapshotId, 'analysis', 'application/json', Buffer.from(JSON.stringify(facts)))
                                refs.push(ref)
                                releases.push(this.artifacts.lease([ref.id]))
                            }
                            for (const i of issues) i.evidenceIds = refs.map((a) => a.id)
                            const allPairs: string[] = manifest ? manifest.parts.flatMap((p, i) => manifest.parts.slice(i + 1).map((q) => pairId(p.id, q.id))) : [],
                                checked = facts?.pairs.map((p) => p.pairId) ?? []
                            const dependencies = [...new Set(sources.flatMap((s) => [s.uri, ...s.sourceReport.snapshot.dependencies.map((d) => d.uri)]))].map((uri) => ({
                                uri,
                                status: 'resolved' as const,
                                dirty: sources.some(
                                    (s) => (s.uri === uri && s.sourceReport.snapshot.document.dirty) || s.sourceReport.snapshot.dependencies.some((d) => d.uri === uri && d.dirty),
                                ),
                            }))
                            const report: AssemblyReport = {
                                schemaVersion: 3,
                                reportId: `cad-${randomUUID()}`,
                                snapshot: {
                                    schemaVersion: 3,
                                    id: snapshotId,
                                    document: { uri: initial.uri, sourceSha256: initial.registry.contentHash, dirty: initial.dirty },
                                    project: { rootUri: initial.rootUri },
                                    dependencies,
                                    manifestDigest: initial.registry.digest,
                                    manifest,
                                    sources,
                                    requirementsHash: key,
                                    algorithm: 'exact-dyadic-bvh-v1',
                                    complete:
                                        !!manifest && sources.length === manifest.parts.length && sources.every((s) => s.sourceReport.snapshot.complete) && !incomplete.length,
                                },
                                executionStatus: facts?.incomplete.some((x) => /WORKER_TIMEOUT/.test(x))
                                    ? 'TIMED_OUT'
                                    : facts?.incomplete.some((x) => /WORKER_(FAILED|EXIT)/.test(x))
                                      ? 'FAILED'
                                      : 'SUCCEEDED',
                                overallStatus: 'UNRESOLVED',
                                units: 'mm',
                                checks,
                                issues,
                                artifacts: refs,
                                facts,
                                incomplete: [...new Set(incomplete)],
                                examined: checked,
                                notExamined: allPairs.filter((p) => !checked.includes(p)),
                                createdAt: Date.now(),
                            }
                            report.overallStatus = verdict(report.executionStatus, checks, report.snapshot.complete)
                            stop.throwIfAborted()
                            const bytes = Buffer.byteLength(JSON.stringify(report))
                            if (bytes > 16 * 1048576) throw new CapabilityError('REPORT_BUDGET_EXCEEDED', 'Assembly evidence exceeds report storage budget.')
                            const frozen = structuredClone(report),
                                freeze = (x: unknown) => {
                                    if (x && typeof x === 'object' && !Object.isFrozen(x)) {
                                        Object.freeze(x)
                                        Object.values(x).forEach(freeze)
                                    }
                                }
                            freeze(frozen)
                            this.reports.set(report.reportId, { report: frozen, bytes })
                            this.latest.set(this.key(final, input), report.reportId)
                            this.prune()
                            return frozen
                        } finally {
                            releases.reverse().forEach((r) => r())
                        }
                    }, shared)
                    .finally(() => {
                        if (this.baselines.get(key) === initial) {
                            this.active.delete(key)
                            this.baselines.delete(key)
                        }
                    })
            },
            caller,
        )
    }
    dispose() {
        this.tasks.dispose()
        this.reports.clear()
        this.latest.clear()
    }
}
import { parseTree, findNodeAtLocation } from 'jsonc-parser'
function jsonOffset(text: string, pointer: string) {
    const t = parseTree(text)
    return t
        ? (findNodeAtLocation(
              t,
              pointer
                  .split('/')
                  .slice(1)
                  .map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
          )?.offset ?? 0)
        : 0
}
