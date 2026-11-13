import { readWorldArtifact } from '../../core/assembly/worldMesh'
import { displayMesh } from '../../core/mesh/displayMesh'
import * as vscode from 'vscode'
import { realpath, stat } from 'node:fs/promises'
import { dirname, resolve, isAbsolute, relative, sep } from 'node:path'
import { digest } from '../../core/cad/snapshot'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { parseManifest, pairId } from '../../core/assembly/PartRegistry'
import { AssemblyVerificationService, type FrozenAssembly, type FrozenPart } from '../../core/assembly/VerificationService'
import type { AssemblyInput, AssemblyReport } from '../../core/assembly/types'
import type { MeshReport, MeshReference, RenderViewsInput, Vec3 } from '../../core/mesh/types'
import { assemblyInWorker, configureAssemblyWorker } from '../../platform/cad/AssemblyWorker'
import { OperationQueue } from '../../platform/cad/OperationQueue'
import { assertWorkspacePath, workspaceFolderForUri } from '../../platform/WorkspacePaths'
import type { CadWorkspaceService } from './CadWorkspaceService'
import type { MeshWorkspaceService } from './MeshWorkspaceService'
export class AssemblyWorkspaceService implements vscode.Disposable {
    readonly core: AssemblyVerificationService
    private readonly queue = new OperationQueue()
    private readonly subscriptions: vscode.Disposable[] = []
    private readonly published = new Map<string, AssemblyReport>()
    private readonly timers = new Set<ReturnType<typeof setTimeout>>()
    constructor(
        context: vscode.ExtensionContext,
        private readonly cad: CadWorkspaceService,
        private readonly mesh: MeshWorkspaceService,
    ) {
        configureAssemblyWorker(vscode.Uri.joinPath(context.extensionUri, 'dist', 'assembly-verification-worker.mjs').fsPath)
        this.core = new AssemblyVerificationService(
            {
                freeze: (uri) => this.freeze(uri),
                unchanged: (initial) => this.unchanged(initial),
                verify: (input, signal) => mesh.verifyPart(input, signal),
                current: (r) => mesh.core.current(r),
                analyze: (parts, pairs, signal) => mesh.runGeometry((active) => assemblyInWorker(parts, pairs, active), signal),
                schedule: (task, signal) => this.queue.run(task, signal),
            },
            mesh.artifacts,
        )
        mesh.externalCurrent = (r) => (this.core.has(r.reportId) ? this.core.current(this.core.get(r.reportId)) : undefined)
        const changed = () => {
            cad.notifyGeometryReports()
            void cad.problems.revalidate()
        }
        const watcher = vscode.workspace.createFileSystemWatcher('**/.scad/verification.json')
        this.subscriptions.push(
            watcher,
            watcher.onDidChange(changed),
            watcher.onDidCreate(changed),
            watcher.onDidDelete(changed),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.contentChanges.length) changed()
            }),
        )
    }
    private trust() {
        if (!vscode.workspace.isTrusted) throw new CapabilityError('WORKSPACE_UNTRUSTED', 'CAD assembly analysis requires Workspace Trust.')
    }
    private async manifestUri(input: string) {
        const uri = vscode.Uri.parse(input, true)
        if (uri.scheme !== 'file') throw new CapabilityError('INVALID_PATH', 'Choose a local workspace Manifest URI.')
        try {
            await assertWorkspacePath(uri, true)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const folder = await workspaceFolderForUri(uri)
        if (!folder) throw new CapabilityError('INVALID_PROJECT', 'Manifest must belong to an open workspace.')
        return /\/\.scad\/verification\.json$/i.test(uri.path) ? uri : vscode.Uri.joinPath(folder.uri, '.scad', 'verification.json')
    }
    private async registry(input: string) {
        this.trust()
        const requested = await this.manifestUri(input)
        let uri = requested,
            text = '',
            dirty = false,
            missing = false
        try {
            await assertWorkspacePath(requested)
            uri = vscode.Uri.file(await realpath(requested.fsPath))
            const aliases = await Promise.all(
                vscode.workspace.textDocuments
                    .filter((d) => !d.isClosed && d.uri.scheme === 'file')
                    .map(async (d) => ({ d, path: await realpath(d.uri.fsPath).catch(() => undefined) })),
            )
            const open = aliases.find((a) => a.path === uri.fsPath && a.d.isDirty)?.d ?? aliases.find((a) => a.path === uri.fsPath)?.d
            if (open?.isDirty) {
                text = open.getText()
                dirty = open.isDirty
            } else {
                const bytes = await vscode.workspace.fs.readFile(uri)
                if (bytes.length > 1048576) throw new CapabilityError('MANIFEST_BUDGET', 'Manifest exceeds 1 MiB.')
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) missing = true
            else throw error
        }
        const registry = missing
            ? {
                  manifest: null,
                  digest: digest(''),
                  contentHash: digest(''),
                  issues: [{ code: 'NO_STABLE_PARTS', message: 'Optional .scad/verification.json is absent; no stable parts declared.', pointer: '', offset: 0, length: 1 }],
              }
            : parseManifest(text)
        const folder = await workspaceFolderForUri(uri),
            displayUri = folder ? vscode.Uri.joinPath(folder.uri, ...relative(await realpath(folder.uri.fsPath), uri.fsPath).split(sep)).toString() : uri.toString()
        return { uri: uri.toString(), displayUri, text, dirty, rootUri: vscode.Uri.file(dirname(dirname(uri.fsPath))).toString(), registry }
    }
    async freeze(input: string): Promise<FrozenAssembly> {
        const frozen = await this.registry(input),
            parts: FrozenPart[] = []
        if (frozen.registry.manifest)
            for (const part of frozen.registry.manifest.parts) {
                const selector = part.selector,
                    reference = selector.type === 'file' ? selector.path : (selector.entry ?? frozen.registry.manifest.entry!)
                if ((!isAbsolute(reference) && /^[a-z][a-z0-9+.-]*:/i.test(reference)) || reference.includes('\0'))
                    throw new CapabilityError('INVALID_PATH', 'Part entries must be local workspace paths.')
                const uri = vscode.Uri.file(resolve(vscode.Uri.parse(frozen.rootUri).fsPath, reference))
                try {
                    await assertWorkspacePath(uri)
                    if (!/\.(scad|csg|stl|3mf)$/i.test(uri.path) || (selector.type === 'define' && !/\.(scad|csg)$/i.test(uri.path)))
                        throw new CapabilityError('INVALID_SELECTOR', 'Choose a supported source type; define selection requires SCAD/CSG.')
                } catch (error) {
                    const index = frozen.registry.manifest.parts.indexOf(part),
                        pointer = `/parts/${index}/selector`
                    frozen.registry.issues.push({
                        code: error instanceof CapabilityError ? error.code : 'PART_SOURCE_MISSING',
                        message: error instanceof Error ? error.message : 'Source unavailable',
                        pointer,
                        offset: frozen.text.indexOf(JSON.stringify(part.id)),
                        length: part.id.length + 2,
                    })
                    continue
                }
                const request = {
                        uri: uri.toString(),
                        units: 'mm' as const,
                        requireNonEmpty: true,
                        exportSelection: selector.type === 'define' ? { name: selector.name, value: selector.value } : undefined,
                    },
                    capture = await this.mesh.capturePart(request)
                const stabilityHash = this.partIdentity(capture)
                parts.push({ id: part.id, input: request, capture, stabilityHash, inputBytes: capture.scad ? Buffer.byteLength(capture.scad.text) : (await stat(uri.fsPath)).size })
            }
        if (frozen.registry.issues.length) {
            frozen.registry.manifest = null
            parts.length = 0
        }
        return { ...frozen, parts }
    }
    private partIdentity(capture: Awaited<ReturnType<MeshWorkspaceService['capturePart']>>) {
        const scad = capture.scad?.snapshot,
            s = capture.snapshot
        return digest({
            document: s.document.sourceSha256,
            uri: s.document.uri,
            runtime: s.runtime,
            quality: s.quality,
            units: s.units,
            policy: s.policyHash,
            project: scad?.project ?? s.project,
            constraints: scad?.constraintsDigest,
            evaluation: scad?.evaluation,
            inputEvidence: s.inputEvidenceHash,
        })
    }
    private async unchanged(initial: FrozenAssembly) {
        // Re-evaluate each original candidate/dependency scope. First CLI discovery
        // may add dependencies, but cannot erase a changed original candidate.
        for (const p of initial.parts) {
            const basis = await this.mesh.capturePart(
                p.input,
                p.capture.snapshot.dependencies.map((d) => vscode.Uri.parse(d.uri).fsPath),
            )
            if (this.partIdentity(basis) !== p.stabilityHash || Object.entries(p.capture.stamps).some(([k, v]) => basis.stamps[k] !== v)) return false
        }
        return true
    }
    async list(input: { uri?: string; reportId?: string; section?: 'parts' | 'checks'; offset?: number; limit?: number; includeHints?: boolean }) {
        this.trust()
        if (!!input.uri === !!input.reportId) throw new CapabilityError('INVALID_INPUT', 'Supply exactly one of uri or reportId.')
        const report = input.reportId ? this.core.get(input.reportId) : undefined,
            frozen = report ? undefined : await this.registry(input.uri!),
            manifest = report?.snapshot.manifest ?? frozen?.registry.manifest,
            uri = report?.snapshot.document.uri ?? frozen!.uri,
            digestValue = report?.snapshot.manifestDigest ?? frozen!.registry.digest,
            section = input.section ?? 'parts',
            offset = input.offset ?? 0,
            limit = input.limit ?? 20
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 32)
            throw new CapabilityError('INVALID_INPUT', 'Invalid declaration pagination.')
        if (report) await this.core.ensureArtifacts(report)
        const items =
            section === 'parts'
                ? manifest?.parts.map((p) => ({
                      ...p,
                      identity: { manifestUri: uri, partId: p.id },
                      ...(input.includeHints
                          ? {
                                hints:
                                    report?.facts?.parts
                                        .find((f) => f.id === p.id)
                                        ?.local.objects.map((o) => ({ instanceId: o.instanceId, componentCount: o.componentCount, stableIdentity: false })) ?? [],
                            }
                          : {}),
                  }))
                : manifest?.checks
        const all = items ?? []
        const result = {
            reportId: report?.reportId,
            manifestUri: uri,
            manifestDigest: digestValue,
            current: report ? await this.core.current(report) : true,
            status: manifest ? 'PASS' : frozen?.registry.issues.some((i) => i.code !== 'NO_STABLE_PARTS') ? 'FAIL' : 'UNRESOLVED',
            issues: frozen?.registry.issues ?? [],
            section,
            total: all.length,
            offset,
            items: all.slice(offset, offset + limit),
            nextOffset: offset + limit < all.length ? offset + limit : null,
            pairs:
                manifest && section === 'parts'
                    ? manifest.parts.flatMap((p, i) => manifest.parts.slice(i + 1).map((q) => ({ pairId: pairId(p.id, q.id), parts: [p.id, q.id] }))).slice(offset, offset + limit)
                    : undefined,
        }
        while (Buffer.byteLength(JSON.stringify(result)) > 32768 && result.items.length > 1) {
            result.items.pop()
            result.nextOffset = offset + result.items.length
        }
        return result
    }
    async check(input: AssemblyInput, signal?: AbortSignal) {
        this.trust()
        const report = await this.core.check(input, signal)
        signal?.throwIfAborted()
        if (!input.reportId) {
            if (!(await this.core.current(report))) throw new CapabilityError('SNAPSHOT_CHANGED', 'Assembly report became historical before publication.', true)
            this.published.set(report.snapshot.document.uri, report)
            if (vscode.workspace.getConfiguration('scad-ai-ide.verification').get<boolean>('publishProblems', true))
                await this.cad.problems.reportVerification(report, () => this.core.current(report), 'assembly')
            this.cad.notifyGeometryReports()
            const timer = setTimeout(
                () => {
                    this.timers.delete(timer)
                    if (this.published.get(report.snapshot.document.uri)?.reportId === report.reportId) {
                        this.cad.problems.clear(vscode.Uri.parse(report.snapshot.document.uri), 'assembly')
                        this.published.delete(report.snapshot.document.uri)
                        this.cad.notifyGeometryReports()
                    }
                },
                Math.max(0, report.createdAt + 1800000 - Date.now()),
            )
            timer.unref()
            this.timers.add(timer)
        }
        return this.summary(report)
    }
    async summary(report: AssemblyReport) {
        const summary = {
            schemaVersion: 3,
            reportUri: `scad-cad-report:/${report.reportId}`,
            reportId: report.reportId,
            snapshotId: report.snapshot.id,
            manifestDigest: report.snapshot.manifestDigest,
            current: await this.core.current(report),
            executionStatus: report.executionStatus,
            overallStatus: report.overallStatus,
            units: 'mm',
            precision: 'based-on-frozen-exported-mesh',
            complete: report.snapshot.complete,
            checks: report.checks.slice(0, 32),
            checkCount: report.checks.length,
            issues: report.issues.slice(0, 32).map(({ spatial: _s, evidenceIds: _e, ...i }) => i),
            issueCount: report.issues.length,
            pairs: report.facts?.pairs.slice(0, 8),
            pairCount: report.facts?.pairs.length ?? 0,
            incomplete: report.incomplete,
            coverage: { checkedPairs: report.examined, uncheckedPairCount: report.notExamined.length, uncheckedPairs: report.notExamined.slice(0, 32) },
            notChecked: ['overlap-volume', 'motion', 'analytic-surface-error', 'thickness', 'printability'],
        }
        while (Buffer.byteLength(JSON.stringify(summary)) > 32768) {
            if (summary.issues.length) summary.issues.pop()
            else if (summary.pairs?.length) summary.pairs.pop()
            else if (summary.checks.length) summary.checks.pop()
            else throw new CapabilityError('SUMMARY_BUDGET', 'Assembly summary exceeds 32 KiB. Read the report in pages.')
        }
        return summary
    }
    async issueDetails(reportId: string, issueId: string, includeEvidence: boolean, cursor = 0, limit = 100) {
        this.trust()
        const report = this.core.get(reportId),
            issue = report.issues.find((i) => i.id === issueId)
        if (!issue) throw new CapabilityError('ISSUE_NOT_FOUND', 'Issue does not belong to this assembly report.')
        await this.core.ensureArtifacts(report)
        if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200)
            throw new CapabilityError('INVALID_INPUT', 'Invalid evidence pagination.')
        const evidence = issue.pairId
            ? (report.facts?.pairs.filter((p) => p.pairId === issue.pairId) ?? [])
            : (report.facts?.parts.filter((p) => issue.partIds?.includes(p.id)).flatMap((p) => p.local.findings.slice(0, 100)) ?? [])
        const items = evidence.slice(cursor, cursor + limit)
        while (Buffer.byteLength(JSON.stringify(items)) > 8192 && items.length > 1) items.pop()
        const log =
            issue.source === 'cli'
                ? report.snapshot.sources
                      .filter((s) => issue.partIds?.includes(s.partId))
                      .flatMap((s) => s.sourceReport.artifacts)
                      .find((a) => a.kind === 'log')
                : undefined
        const text = log
            ? Buffer.from(await this.mesh.artifacts.read(log.id))
                  .toString('utf8')
                  .slice(0, 8192)
            : JSON.stringify(items).slice(0, 8192)
        return {
            reportId,
            snapshotId: report.snapshot.id,
            current: await this.core.current(report),
            evidence: includeEvidence ? { text, artifactId: log?.id, truncated: (log?.bytes ?? 0) > 8192 || cursor + items.length < evidence.length } : undefined,
            issue: { ...issue, spatial: includeEvidence ? issue.spatial : undefined },
            ...(includeEvidence
                ? {
                      geometryEvidence: {
                          coordinateUnits: 'mm',
                          items,
                          nextCursor: cursor + items.length < evidence.length ? cursor + items.length : null,
                          artifacts: report.artifacts.slice(cursor, cursor + Math.min(limit, 10)),
                          nextArtifactCursor: cursor + Math.min(limit, 10) < report.artifacts.length ? cursor + Math.min(limit, 10) : null,
                      },
                  }
                : {}),
        }
    }
    async reportText(id: string) {
        this.trust()
        const report = this.core.get(id)
        await this.core.ensureArtifacts(report)
        return JSON.stringify({ current: await this.core.current(report), ...report }, null, 2)
    }
    async measure(input: MeshReference & { partIds?: string[]; measurementTypes?: string[]; objectOffset?: number; objectLimit?: number }) {
        this.trust()
        const report = this.core.get(input.reportId!)
        await this.core.ensureArtifacts(report)
        const ids = input.partIds ?? report.snapshot.manifest?.parts.map((p) => p.id) ?? []
        this.validateParts(report, ids)
        const offset = input.objectOffset ?? 0,
            limit = input.objectLimit ?? 20,
            requested = input.measurementTypes ?? ['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology']
        if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 20 ||
            requested.some((k) => !['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology'].includes(k))
        )
            throw new CapabilityError('INVALID_INPUT', 'Invalid measurement selection or pagination.')
        const selected = report.facts?.parts.filter((p) => ids.includes(p.id)) ?? []
        const quantity = (f: import('../../core/mesh/types').GeometryFacts) =>
            Object.fromEntries(
                requested.map((k) => [
                    k,
                    k === 'topology'
                        ? { vertices: f.rawVertices, triangles: f.rawTriangles, componentCount: f.objects.reduce((n, o) => n + o.componentCount, 0), complete: f.complete }
                        : f[k as 'bounds' | 'surfaceArea' | 'signedVolume' | 'physicalVolume'],
                ]),
            )
        const result = {
            reportId: report.reportId,
            snapshotId: report.snapshot.id,
            current: await this.core.current(report),
            units: 'mm',
            precision: 'based-on-frozen-exported-mesh',
            overallStatus: report.overallStatus,
            parts: selected.slice(offset, offset + limit).map((p) => ({
                partId: p.id,
                local: quantity(p.local),
                assembly: quantity(p.world),
                matrix: p.matrix,
                physicalVolumeBound: requested.includes('physicalVolume') ? p.volumeBound : undefined,
            })),
            total: selected.length,
            offset,
            nextOffset: offset + limit < selected.length ? offset + limit : null,
            assemblyPhysicalVolume: { status: 'UNRESOLVED', value: null, reason: 'UNION_VOLUME_NOT_CHECKED' },
            incomplete: report.incomplete,
        }
        while (Buffer.byteLength(JSON.stringify(result)) > 32768 && result.parts.length > 1) {
            result.parts.pop()
            result.nextOffset = offset + result.parts.length
        }
        return result
    }
    private validateParts(report: AssemblyReport, ids: string[]) {
        if (!ids.length || ids.length > 32 || new Set(ids).size !== ids.length || ids.some((id) => !report.snapshot.manifest?.parts.some((p) => p.id === id)))
            throw new CapabilityError('PART_NOT_FOUND', 'Choose declared part IDs in this report.')
    }
    async renderViews(input: RenderViewsInput & { partIds?: string[] }, signal?: AbortSignal) {
        this.trust()
        const report = this.core.get(input.reportId!)
        await this.core.ensureArtifacts(report)
        if (input.partIds) {
            this.validateParts(report, input.partIds)
        }
        const first = report.snapshot.sources[0]?.sourceReport
        let render = report.artifacts.find((a) => a.snapshotId === report.snapshot.id && a.role === 'render')
        if (input.partIds) {
            const world = report.artifacts.find((a) => a.mimeType === 'application/vnd.scad-ai-ide.world-mesh')
            if (world) {
                const display = displayMesh(readWorldArtifact(await this.mesh.artifacts.read(world.id), input.partIds))
                if (display) {
                    const ref = await this.mesh.artifacts.put(report.snapshot.id, 'mesh', 'model/stl', display.bytes)
                    render = { ...ref, role: 'render', derivation: { inputSha256: world.sha256, numericType: 'float32', maxCoordinateError: display.maxCoordinateError } }
                }
            }
        }
        if (!first)
            return {
                reportId: report.reportId,
                snapshotId: report.snapshot.id,
                current: await this.core.current(report),
                renderStatus: 'UNAVAILABLE' as const,
                reasonCode: 'ASSEMBLY_MESH_UNAVAILABLE',
                frames: [],
                delivery: 'metadata' as const,
                notExamined: ['visual-inspection'],
            }
        const boxes = report.facts?.parts.filter((p) => !input.partIds || input.partIds.includes(p.id)).flatMap((p) => (p.world.bounds ? [p.world.bounds] : [])) ?? [],
            min = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]))) as Vec3,
            max = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k]))) as Vec3
        const view: MeshReport = {
            ...first,
            reportId: report.reportId,
            snapshot: { ...first.snapshot, id: report.snapshot.id, meshSha256: report.artifacts.find((a) => a.mimeType === 'application/vnd.scad-ai-ide.world-mesh')?.sha256 },
            artifacts: render ? [render] : [],
            facts: first.facts ? { ...first.facts, bounds: boxes.length ? { min, max, dimensions: max.map((v, k) => v - min[k]) as Vec3 } : null } : null,
        }
        const release = this.mesh.artifacts.lease(render ? [render.id] : [])
        try {
            return {
                ...(await this.mesh.images.render(view, input, signal)),
                partIds: input.partIds ?? report.snapshot.manifest?.parts.map((p) => p.id),
                sourceCoordinateFrame: 'assembly-world',
            }
        } finally {
            release()
        }
    }
    invalidateScad() {
        for (const [uri, report] of this.published)
            if (report.snapshot.sources.some((s) => s.sourceReport.snapshot.runtime.used)) {
                this.cad.problems.clear(vscode.Uri.parse(uri), 'assembly')
                this.published.delete(uri)
            }
        this.cad.notifyGeometryReports()
    }
    dispose() {
        this.queue.dispose()
        this.core.dispose()
        this.subscriptions.forEach((s) => s.dispose())
        this.timers.forEach(clearTimeout)
        this.mesh.externalCurrent = undefined
        for (const uri of this.published.keys()) this.cad.problems.clear(vscode.Uri.parse(uri), 'assembly')
        this.published.clear()
    }
}
