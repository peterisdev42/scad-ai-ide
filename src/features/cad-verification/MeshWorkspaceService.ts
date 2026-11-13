import * as vscode from 'vscode'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, realpath, mkdir, readdir, rm, lstat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { MeshImages, type RenderResult } from '../../platform/cad/MeshImages'
import { ArtifactStore } from '../../platform/cad/ArtifactStore'
import { OperationQueue } from '../../platform/cad/OperationQueue'
import { analyzeInWorker, configureMeshVerificationWorker } from '../../platform/cad/MeshWorker'
import { MeshVerificationService, type MeshCapture, type MaterializedMesh } from '../../core/mesh/VerificationService'
import { meshLimits, type MeshSnapshot, type MeshReport, type VerifyMeshInput, type MeshReference, type RenderViewsInput } from '../../core/mesh/types'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { digest } from '../../core/cad/snapshot'
import { CadVerificationService } from '../../core/cad/CadVerificationService'
import type { CadInputs, CadExecutionResult } from '../../core/cad/types'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { assertWorkspacePath, workspaceFolderForUri } from '../../platform/WorkspacePaths'
import { cadExecution } from '../../platform/openscad/CadExecutionService'
import type { CadWorkspaceService } from './CadWorkspaceService'
import type { registerRuntime } from '../runtime/registerRuntime'
const kernel = 'raw-mesh-v1+robust-predicates-3.0.2+decoder-v1'
const policy = { kernel, limits: meshLimits, weld: 'exact', units: 'explicit-or-3mf-metadata', fill: 'oriented-stl-positive-3mf' }
interface Frozen extends MeshCapture {
    path: string
    scad?: CadInputs
}
async function binaryIdentity(file: string) {
    const before = await stat(file, { bigint: true })
    if (!before.isFile() || before.size > BigInt(meshLimits.inputBytes)) throw new CapabilityError('INPUT_TOO_LARGE', 'Mesh input exceeds 128 MiB or is not a file.')
    const stamp = (s: typeof before) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`,
        hash = createHash('sha256')
    let size = 0
    for await (const data of createReadStream(file)) {
        size += data.length
        if (size > meshLimits.inputBytes) throw new CapabilityError('INPUT_TOO_LARGE', 'Mesh grew beyond its byte budget.')
        hash.update(data)
    }
    const after = await stat(file, { bigint: true })
    if (stamp(before) !== stamp(after)) throw new CapabilityError('SNAPSHOT_CHANGED', 'Mesh input changed while it was read.', true)
    return { hash: hash.digest('hex'), stamp: stamp(after) }
}
/** Host adapter for v2. No Preview, Customizer panel or runtime is needed for raw meshes. */
export class MeshWorkspaceService implements vscode.Disposable {
    externalCurrent?: (report: MeshReport) => Promise<boolean> | undefined
    readonly core: MeshVerificationService
    private readonly partExports: MeshVerificationService
    readonly artifacts: ArtifactStore
    readonly images: MeshImages
    private readonly execution = new OperationQueue()
    private readonly geometryWorkers = new OperationQueue()
    runGeometry<T>(task:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal) { return this.geometryWorkers.run(task,signal) }
    private readonly captures = new OperationQueue()
    private readonly dependencies = new Map<string, string[]>()
    private readonly subscriptions: vscode.Disposable[] = []
    private readonly published = new Map<string, string>()
    private readonly expiry = new Set<ReturnType<typeof setTimeout>>()
    private readonly inputKinds = new Map<string, string>()
    private readonly inputAliases = new Map<string,string>()
    private disposed = false
    private readonly heartbeat: ReturnType<typeof setInterval>
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly cad: CadWorkspaceService,
        private readonly runtime: ReturnType<typeof registerRuntime>,
    ) {
        configureMeshVerificationWorker(vscode.Uri.joinPath(context.extensionUri, 'dist', 'mesh-verification-worker.mjs').fsPath)
        const workspace = digest((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString()).sort())
        const parent = join(context.globalStorageUri.fsPath, 'cad-artifacts', workspace)
        const directory = join(parent, randomUUID())
        this.artifacts = new ArtifactStore(directory)
        this.heartbeat = setInterval(() => {
            void utimes(directory, new Date(), new Date()).catch(() => {})
        }, 60000)
        this.heartbeat.unref()
        // Sessions isolate windows. Reap abandoned sessions after TTL, without following links.
        void mkdir(parent, { recursive: true, mode: 0o700 })
            .then(async () => {
                for (const name of await readdir(parent)) {
                    if (!/^[a-f0-9-]{36}$/.test(name)) continue
                    const path = join(parent, name),
                        info = await lstat(path)
                    if (!info.isSymbolicLink() && info.isDirectory() && Date.now() - info.mtimeMs > 1800000) await rm(path, { recursive: true, force: true })
                }
            })
            .catch(() => {})
        this.core = new MeshVerificationService({ capture: (input) => this.captures.run(() => this.capture(input)), materialize: (source, input, signal) => this.materialize(source as Frozen, input, signal), analyze: (bytes, format, signal) => this.runGeometry(active=>analyzeInWorker(bytes, format, active),signal), schedule: (task, signal) => this.execution.run(task, signal) }, this.artifacts)
        // Assembly transactions perform their own all-input revalidation. Their
        // exports must not be cancelled by delayed document-wide Preview notifications.
        this.partExports = new MeshVerificationService({ capture: input => this.captures.run(()=>this.capture(input)), materialize:(source,input,signal)=>this.materialize(source as Frozen,input,signal),analyze:(bytes,format,signal)=>this.runGeometry(active=>analyzeInWorker(bytes,format,active),signal),schedule:(task,signal)=>this.execution.run(task,signal)},this.artifacts)
        this.images = new MeshImages(
            this.artifacts,
            directory,
            async () => {
                await this.runtime.whenReady()
                const active = this.runtime.getActiveRuntime()
                return active ? { command: active.command, version: active.version } : undefined
            },
            (report) => this.externalCurrent?.(report) ?? this.core.current(report),
        )
        const invalidate = () => {
            this.cad.notifyGeometryReports()
            void this.cad.problems.revalidate()
        }
        this.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.contentChanges.length && e.document.uri.scheme === 'file') invalidate()
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('scad-ai-ide')) invalidate()
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(invalidate),
        )
    }
    invalidateScad() {
        for (const [uri, kind] of this.inputKinds) if (kind === 'scad') this.core.invalidate(uri)
        this.cad.notifyGeometryReports()
    }
    refreshFileValidity() {
        this.cad.notifyGeometryReports()
        void this.cad.problems.revalidate()
    }
    invalidate(uri?: vscode.Uri) {
        if (uri && uri.scheme !== 'file') return
        if (!uri) this.core.invalidate()
        else {
            this.core.invalidate(uri.toString())
            for (const [root, deps] of this.dependencies) if (deps.some((p) => vscode.Uri.file(p).toString() === uri.toString())) {const canonical=root.split("\n")[0];this.core.invalidate(canonical);for(const [alias,target]of this.inputAliases)if(target===canonical)this.core.invalidate(alias)}
        }
        this.cad.notifyGeometryReports()
    }
    availability() {
        if (this.disposed) return { enabled: false, reasonCode: 'DISPOSED' }
        if (!vscode.workspace.isTrusted) return { enabled: false, reasonCode: 'UNTRUSTED_WORKSPACE' }
        if (!vscode.workspace.getConfiguration('scad-ai-ide.verification').get<boolean>('enabled', true)) return { enabled: false, reasonCode: 'DISABLED' }
        return { enabled: true, detail: this.runtime.getActiveRuntime() ? 'Mesh files and SCAD Full Render available; PNG depends on rendering environment.' : 'Standalone STL/3MF available; SCAD and PNG require an OpenSCAD runtime.' }
    }
    private assertAvailable() {
        const state = this.availability()
        if (!state.enabled) throw new CapabilityError(state.reasonCode!, 'Geometry verification is unavailable.')
    }
    private validate(input: VerifyMeshInput) {
        if (input.quality && input.quality !== 'verification') throw new CapabilityError('INVALID_INPUT', 'Only verification quality is supported.')
        const t = input.tessellation
        if (t && (Object.keys(t).some((k) => !['fn', 'fa', 'fs'].includes(k)) || Object.values(t).some((v) => typeof v !== 'number' || !Number.isFinite(v)) || (t.fn !== undefined && (!Number.isInteger(t.fn) || t.fn < 0 || t.fn > 10000)) || (t.fa !== undefined && (t.fa <= 0 || t.fa > 360)) || (t.fs !== undefined && t.fs <= 0))) throw new CapabilityError('INVALID_INPUT', 'Invalid explicit tessellation settings.')
    }
    private async dependencyKey(input: VerifyMeshInput) { return vscode.Uri.file(await realpath(vscode.Uri.parse(input.uri,true).fsPath)).toString() + "\n" + digest(input.exportSelection ?? null) }
    async capturePart(input: VerifyMeshInput, dependencies?:string[]) { return this.capture(input,dependencies) }
    async verifyPart(input: VerifyMeshInput, signal?: AbortSignal) { this.assertAvailable(); return this.partExports.verify(input, signal) }
    private async scadCapture(input: VerifyMeshInput, deps: string[]) {
        const base = await this.cad.capture(input.uri, deps, input.projectRoot)
        const tess = Object.fromEntries(Object.entries(input.tessellation ?? {}).map(([key, value]) => [`$${key}`, value]))
        const selection = input.exportSelection
        if (selection && (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(selection.name) || !["string", "number", "boolean"].includes(typeof selection.value) || typeof selection.value === "number" && !Number.isFinite(selection.value))) throw new CapabilityError("INVALID_SELECTOR", "Invalid internal export selector.")
        const parameters = structuredClone({ ...base.parameters, ...(selection ? { [selection.name]: selection.value } : {}), ...tess, $preview: false })
        const frozen = await this.cad.capture(base.snapshot.document.uri, deps, input.projectRoot, { parameters, format: 'stl', sourceTransport: 'stdin', lazyUnion: false })
        if (base.snapshot.document.sourceSha256 !== frozen.snapshot.document.sourceSha256) throw new CapabilityError('SNAPSHOT_CHANGED', 'Source changed while capturing verification parameters.', true)
        return frozen
    }
    private async capture(input: VerifyMeshInput, dependencies?:string[]): Promise<Frozen> {
        this.assertAvailable()
        this.validate(input)
        const uri = vscode.Uri.parse(input.uri, true)
        if (uri.scheme !== 'file' || !/\.(scad|csg|stl|3mf)$/i.test(uri.path)) throw new CapabilityError('INVALID_PATH', 'Choose a workspace SCAD/CSG/STL/3MF file URI.')
        await assertWorkspacePath(uri)
        const kind = /\.(scad|csg)$/i.test(uri.path) ? 'scad' : /\.3mf$/i.test(uri.path) ? '3mf' : 'stl'
        this.inputAliases.set(input.uri,vscode.Uri.file(await realpath(uri.fsPath)).toString())
        while(this.inputAliases.size>128)this.inputAliases.delete(this.inputAliases.keys().next().value!)
        this.inputKinds.delete(input.uri)
        this.inputKinds.set(input.uri, kind)
        while (this.inputKinds.size > 128) this.inputKinds.delete(this.inputKinds.keys().next().value!)
        if (kind !== 'scad' && input.tessellation && Object.keys(input.tessellation).length) throw new CapabilityError('INVALID_INPUT', 'Tessellation settings apply only to SCAD Full Render.')
        let snapshot: Omit<MeshSnapshot, 'id' | 'sourceStateId'>, stamps: Record<string, string>, scad: CadInputs | undefined
        const requestedGlobalTessellation = Object.fromEntries(Object.entries(input.tessellation ?? {}).map(([k, v]) => [`$${k}`, v]))
        const policyHash = digest({ ...policy, units: kind === '3mf' ? undefined : input.units, requireNonEmpty: !!input.requireNonEmpty, exportSelection: input.exportSelection, tessellation: input.tessellation ?? {} })
        if (kind === 'scad') {
            await this.runtime.whenReady()
            scad = await this.scadCapture(input, dependencies ?? this.dependencies.get(await this.dependencyKey(input)) ?? (input.exportSelection ? [] : this.cad.verification.knownDependencies(input.uri)))
            const s = scad.snapshot
            this.cad.trackGeometryInputs(s)
            snapshot = { schemaVersion: 2, kernelVersion: kernel, inputEvidenceHash: s.inputEvidenceHash, document: { ...s.document }, project: { rootUri: s.project.rootUri }, dependencies: s.dependencies, inputKind: kind, runtime: { used: true, identityHash: s.runtime.identityHash, version: s.runtime.version, executable: s.runtime.executable, backend: 'runtime-command/default', commandHash: digest(scad.command) }, quality: { profile: 'verification', requestedGlobalTessellation, exportSelection: input.exportSelection, effectiveOverrides: structuredClone(scad.parameters), localSettings: 'source-controlled' }, units: input.units ?? 'modelUnits', sourceUnit: input.units === 'mm' ? 'user-declared-mm' : 'undeclared', complete: s.complete, unresolvedInputs: s.unresolvedInputs, policyHash, sourceSnapshotId: s.id }
            stamps = { ...scad.fileStamps, bufferVersion: String(s.document.version) }
        } else {
            const canonical = await realpath(uri.fsPath),
                identity = await binaryIdentity(canonical),
                folder = await workspaceFolderForUri(uri)
            if (!folder) throw new CapabilityError('INVALID_PROJECT', 'Mesh must belong to an open workspace.')
            const project = (await libraryEnvironment.resolveProjectRoot(canonical)) ?? folder.uri.fsPath
            if (input.projectRoot && (await realpath(vscode.Uri.parse(input.projectRoot, true).fsPath)) !== (await realpath(project))) throw new CapabilityError('INVALID_PROJECT', 'projectRoot does not match the mesh workspace.')
            const aliases = await Promise.all(vscode.workspace.textDocuments.filter((d) => !d.isClosed && d.uri.scheme === 'file').map(async (d) => ({ document: d, path: await realpath(d.uri.fsPath).catch(() => undefined) })))
            const related = aliases.filter((d) => d.path === canonical).map((d) => d.document),
                open = related.find((d) => d.isDirty) ?? related[0],
                unresolved = related.some((d) => d.isDirty) ? ['DIRTY_MESH_BUFFER_NOT_EVALUATED'] : []
            snapshot = { schemaVersion: 2, kernelVersion: kernel, inputEvidenceHash: digest([!unresolved.length, unresolved]), document: { uri: uri.toString(), sourceSha256: identity.hash, dirty: !!open?.isDirty, version: open?.version }, project: { rootUri: vscode.Uri.file(await realpath(project)).toString() }, dependencies: [], inputKind: kind, runtime: { used: false }, quality: { profile: 'verification', requestedGlobalTessellation: {}, localSettings: 'source-controlled' }, units: kind === '3mf' || input.units === 'mm' ? 'mm' : 'modelUnits', sourceUnit: kind === '3mf' ? '3mf-metadata' : input.units === 'mm' ? 'user-declared-mm' : 'undeclared', complete: !unresolved.length, unresolvedInputs: unresolved, policyHash }
            stamps = { [canonical]: identity.stamp, bufferVersion: String(open?.version) }
            this.cad.watchGeometryFiles(uri.toString(), [canonical])
        }
        const { version: _version, dirty: _dirty, ...document } = snapshot.document
        const sourceStateId = digest({ ...snapshot, document })
        return { snapshot: { ...snapshot, id: sourceStateId, sourceStateId }, stamps, format: kind === '3mf' ? '3mf' : 'stl', path: uri.fsPath, scad }
    }
    private async materialize(source: Frozen, input: VerifyMeshInput, signal: AbortSignal): Promise<MaterializedMesh> {
        if (source.snapshot.inputKind !== 'scad') {
            const chunks: Buffer[] = []
            let length = 0
            for await (const chunk of createReadStream(source.path, { signal })) {
                length += chunk.length
                if (length > meshLimits.inputBytes) throw new CapabilityError('INPUT_TOO_LARGE', 'Mesh grew beyond 128 MiB.')
                chunks.push(chunk as Buffer)
            }
            const bytes = Buffer.concat(chunks)
            if (bytes.length > meshLimits.inputBytes || createHash('sha256').update(bytes).digest('hex') !== source.snapshot.document.sourceSha256) throw new CapabilityError('SNAPSHOT_CHANGED', 'Mesh bytes changed before analysis.', true)
            return { source, bytes, empty: false, executionStatus: 'SUCCEEDED', checks: [], issues: [], incomplete: [] }
        }
        const pre = source.scad!
        await cadExecution.probe({ command: pre.command, path: pre.path, source: pre.text, parameters: pre.parameters, env: pre.env, format: 'stl', signal })
        let result: CadExecutionResult | undefined, lastInputs: CadInputs | undefined
        const service = new CadVerificationService({
            capture: async (uri, deps, projectRoot) => {
                lastInputs = await this.scadCapture({ ...input, uri, projectRoot }, deps)
                return lastInputs
            },
            execute: async (frozen, active) => {
                result = await cadExecution.execute({ command: frozen.command, path: frozen.path, source: frozen.text, parameters: frozen.parameters, env: frozen.env, format: 'stl', signal: active })
                return result
            },
            locate: async (file) => {
                try {
                    const uri = vscode.Uri.file(await realpath(file))
                    await assertWorkspacePath(uri)
                    return uri.toString()
                } catch {
                    return undefined
                }
            },
        })
        try {
            const compilation = await service.analyze({ uri: pre.snapshot.document.uri, projectRoot: pre.snapshot.project.rootUri }, signal)
            const deps = service.knownDependencies(pre.snapshot.document.uri)
            this.dependencies.delete(await this.dependencyKey(input))
            this.dependencies.set(await this.dependencyKey(input), deps)
            while (this.dependencies.size > 128) this.dependencies.delete(this.dependencies.keys().next().value!)
            const final = await this.capture(input)
            if (final.snapshot.sourceSnapshotId !== lastInputs!.snapshot.id) throw new CapabilityError('SNAPSHOT_CHANGED', 'SCAD export is no longer current.', true)
            return { source: final, bytes: result!.status === 'SUCCEEDED' && !result!.empty ? result!.content : undefined, empty: result!.empty, executionStatus: result!.empty ? 'SUCCEEDED' : result!.status, checks: result!.empty ? [] : compilation.checks.map((c) => ({ ...c })), issues: compilation.issues, incomplete: compilation.incomplete, log: result!.log }
        } finally {
            service.dispose()
        }
    }
    async verify(input: VerifyMeshInput, signal?: AbortSignal) {
        this.assertAvailable()
        const report = await this.core.verify(input, signal)
        signal?.throwIfAborted()
        if (!(await this.core.current(report))) throw new CapabilityError('SNAPSHOT_CHANGED', 'Geometry report became historical before publication.', true)
        this.published.set(report.snapshot.document.uri, report.reportId)
        while (this.published.size > 128) this.published.delete(this.published.keys().next().value!)
        if (vscode.workspace.getConfiguration('scad-ai-ide.verification').get<boolean>('publishProblems', true)) await this.cad.problems.reportVerification(report, () => this.core.current(report), 'geometry')
        this.cad.notifyGeometryReports()
        const timer = setTimeout(
            () => {
                this.expiry.delete(timer)
                if (this.published.get(report.snapshot.document.uri) === report.reportId) {
                    this.cad.problems.clear(vscode.Uri.parse(report.snapshot.document.uri), 'geometry')
                    this.cad.notifyGeometryReports()
                }
            },
            Math.max(0, report.createdAt + 1800000 - Date.now()),
        )
        timer.unref()
        this.expiry.add(timer)
        return report
    }
    get(id: string) {
        this.assertAvailable()
        return this.core.get(id)
    }
    async resolve(input: MeshReference, signal?: AbortSignal) {
        if (!!input.uri === !!input.reportId) throw new CapabilityError('INVALID_INPUT', 'Supply exactly one of uri or reportId.')
        const report = input.reportId ? this.get(input.reportId) : await this.verify({ ...input, uri: input.uri! }, signal)
        await this.core.ensureArtifacts(report)
        return report
    }
    async measure(input: MeshReference & { measurementTypes?: string[]; objectOffset?: number; objectLimit?: number }, signal?: AbortSignal) {
        const report = await this.resolve(input, signal),
            current = await this.core.current(report),
            facts = report.facts
        const requested = input.measurementTypes ?? ['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology']
        if (requested.some((t) => !['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology'].includes(t))) throw new CapabilityError('INVALID_INPUT', 'Unknown measurement type.')
        const offset = input.objectOffset ?? 0,
            limit = input.objectLimit ?? 20
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new CapabilityError('INVALID_INPUT', 'Invalid object pagination.')
        const objects = facts?.objects ?? [],
            selected = objects.slice(offset, offset + limit)
        const values = Object.fromEntries(requested.map((type) => [type, type === 'topology' ? (selected.map((o) => ({ instanceId: o.instanceId, vertices: o.vertices, triangles: o.triangles, componentCount: o.componentCount, boundaryEdges: o.boundaryEdges, nonManifoldEdges: o.nonManifoldEdges, nonManifoldVertices: o.nonManifoldVertices, inconsistentEdges: o.inconsistentEdges, degenerateFaces: o.degenerateFaces, duplicateFaces: o.duplicateFaces })) ?? null) : (facts?.[type as 'bounds' | 'surfaceArea' | 'signedVolume' | 'physicalVolume'] ?? null)]))
        return { reportId: report.reportId, snapshotId: report.snapshot.id, current, overallStatus: report.overallStatus, units: report.units, precision: 'computed-on-decoded-mesh', values, objects: { total: objects.length, offset, hasMore: offset + selected.length < objects.length, nextOffset: offset + selected.length < objects.length ? offset + selected.length : null, items: selected.map((o) => ({ instanceId: o.instanceId, objectId: o.objectId, status: o.status, values: Object.fromEntries(requested.filter((t) => t !== 'topology').map((t) => [t, o[t as 'bounds' | 'surfaceArea' | 'signedVolume' | 'physicalVolume']])) })) }, incomplete: report.incomplete, notExamined: report.notExamined }
    }
    async reportText(id: string) {
        const report = this.get(id)
        await this.core.ensureArtifacts(report)
        return JSON.stringify({ current: await this.core.current(report), ...report }, null, 2)
    }
    async issueDetails(reportId: string, issueId: string, includeEvidence: boolean, cursor = 0, limit = 100) {
        const report = this.get(reportId),
            issue = report.issues.find((i) => i.id === issueId)
        if (!issue) throw new CapabilityError('ISSUE_NOT_FOUND', 'Issue does not belong to this geometry report.')
        await this.core.ensureArtifacts(report)
        if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new CapabilityError('INVALID_INPUT', 'Invalid evidence pagination.')
        const objects = report.facts?.objects.filter((o) => !issue.spatial?.instanceId || o.instanceId === issue.spatial.instanceId) ?? []
        const components = objects.flatMap((o) => o.components.map((c) => ({ instanceId: o.instanceId, ...c })))
        const log = report.artifacts.find((a) => a.kind === 'log')
        const text = includeEvidence
            ? log
                ? Buffer.from(await this.artifacts.read(log.id))
                      .toString('utf8')
                      .slice(0, 32768)
                : JSON.stringify({ code: issue.code, spatial: issue.spatial }).slice(0, 32768)
            : ''
        return { reportId, snapshotId: report.snapshot.id, current: await this.core.current(report), issue, evidence: includeEvidence ? { artifactId: log?.id, text, truncated: (log?.bytes ?? 0) > 32768 } : undefined, ...(includeEvidence ? { geometryEvidence: { coordinateUnits: report.units, triangleSamples: (issue.spatial?.triangleSamples ?? []).slice(cursor, cursor + limit), nextSampleCursor: (issue.spatial?.triangleSamples?.length ?? 0) > cursor + limit ? cursor + limit : null, samplesTruncated: (issue.spatial?.triangleSamples?.length ?? 0) < (issue.spatial?.triangles.length ?? 0), bounds: report.facts?.bounds, components: components.slice(cursor, cursor + limit), nextComponentCursor: components.length > cursor + limit ? cursor + limit : null, instanceId: issue.spatial?.instanceId, triangles: (issue.spatial?.triangles ?? []).slice(cursor, cursor + limit), point: issue.spatial?.point, nextCursor: (issue.spatial?.triangles.length ?? 0) > cursor + limit ? cursor + limit : null, artifacts: report.artifacts } } : {}) }
    }
    async renderViews(input: RenderViewsInput, signal?: AbortSignal) {
        const report = await this.resolve(input, signal)
        return this.images.render(report, input, signal)
    }
    imagePayloads(result: RenderResult) {
        this.assertAvailable()
        return this.images.payloads(result)
    }
    readImage(id: string) {
        this.assertAvailable()
        return this.images.read(id)
    }
    dispose() {
        this.disposed = true
        clearInterval(this.heartbeat)
        this.execution.dispose()
        this.geometryWorkers.dispose()
        this.captures.dispose()
        this.core.dispose()
        this.partExports.dispose()
        this.images.dispose()
        this.subscriptions.forEach((s) => s.dispose())
        this.expiry.forEach(clearTimeout)
        this.expiry.clear()
        void this.artifacts.dispose()
        this.dependencies.clear()
        this.inputAliases.clear()
    }
}
