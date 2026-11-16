import * as vscode from 'vscode'
import { mkdir, readdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { digest } from '../../core/cad/snapshot'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { ReviewEvidenceStore } from '../../platform/review/ReviewEvidenceStore'
import { assertWorkspacePath, workspaceFolderForUri } from '../../platform/WorkspacePaths'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import type { VerificationEvidence, SubjectInput, PersistedBundle } from '../../core/review/types'
import type { CadWorkspaceService } from '../cad-verification/CadWorkspaceService'
import type { ArtifactRef, MeshReport } from '../../core/mesh/types'
export interface EvidenceHandle {
    report: VerificationEvidence
    ownerUri: string
    store: ReviewEvidenceStore
    read(id: string): Promise<Uint8Array>
    release(): void
    current(): Promise<boolean>
}
export function rawRefs(r: VerificationEvidence): ArtifactRef[] {
    const refs = r.schemaVersion === 3 ? r.snapshot.sources.flatMap((s) => s.sourceReport.artifacts.filter((a) => a.role === 'raw')) : r.artifacts.filter((a) => a.role === 'raw')
    return [...new Map(refs.map((a) => [a.id, a])).values()]
}
export class EvidenceRepository {
    private readonly stores = new Map<string, ReviewEvidenceStore>()
    private readonly root: string
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly cad: CadWorkspaceService,
    ) {
        this.root = join(context.globalStorageUri.fsPath, 'cad-review')
    }
    trust() {
        if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Review evidence requires Workspace Trust.')
    }
    async canonical(uri: string) {
        const parsed = vscode.Uri.parse(uri, true)
        await assertWorkspacePath(parsed, true)
        return vscode.Uri.file(await realpath(parsed.fsPath).catch(() => realpath(dirname(parsed.fsPath)).then((parent) => join(parent, parsed.path.split('/').at(-1)!)))).toString()
    }
    async storeForOwner(uri: string) {
        this.trust()
        const path = vscode.Uri.parse(uri, true)
        await assertWorkspacePath(path, true)
        const project = /\/\.scad\/verification\.json$/i.test(path.path) ? dirname(dirname(path.fsPath)) : ((await libraryEnvironment.resolveProjectRoot(path.fsPath)) ?? (await workspaceFolderForUri(path))?.uri.fsPath)
        if (!project) throw new CapabilityError('INVALID_PROJECT', 'Review must belong to a workspace project.')
        const projectUri = vscode.Uri.file(await realpath(project)).toString(),
            key = digest({ project: projectUri, remote: vscode.env.remoteName ?? 'local' })
        let store = this.stores.get(key)
        if (!store) {
            const directory = join(this.root, key)
            await mkdir(directory, { recursive: true, mode: 0o700 })
            if ((await lstat(directory)).isSymbolicLink()) throw new CapabilityError('INVALID_PATH', 'Linked review directory is not allowed.')
            try {
                await writeFile(join(directory, 'owner.json'), JSON.stringify({ schemaVersion: 1, projectUri }), { flag: 'wx', mode: 0o600 })
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
            }
            store = new ReviewEvidenceStore(directory)
            this.stores.set(key, store)
        }
        return store
    }
    async activeStores() {
        this.trust()
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        for (const entry of await readdir(this.root, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name) || this.stores.has(entry.name)) continue
            try {
                const path = join(this.root, entry.name, 'owner.json'),
                    info = await lstat(path)
                if (info.isSymbolicLink() || info.size > 4096) continue
                const meta = JSON.parse(await readFile(path, 'utf8'))
                if (meta.schemaVersion !== 1 || typeof meta.projectUri !== 'string' || !(await workspaceFolderForUri(vscode.Uri.parse(meta.projectUri, true)))) continue
                const key = digest({ project: meta.projectUri, remote: vscode.env.remoteName ?? 'local' })
                if (key !== entry.name) continue
                this.stores.set(key, new ReviewEvidenceStore(join(this.root, key)))
            } catch {
                /* Unavailable retired projects are not opened or interpreted. */
            }
        }
        return [...this.stores.values()]
    }
    async current(report: VerificationEvidence): Promise<boolean> {
        try {
            await assertWorkspacePath(vscode.Uri.parse(report.snapshot.document.uri, true))
            if (report.schemaVersion === 3) {
                const now = await this.cad.assembly!.freeze(report.snapshot.document.uri)
                if (now.registry.contentHash !== report.snapshot.document.sourceSha256 || now.parts.length !== report.snapshot.sources.length) return false
                for (const s of report.snapshot.sources) if (!(await this.meshCurrent(s.sourceReport))) return false
                return true
            }
            return this.meshCurrent(report)
        } catch {
            return false
        }
    }
    private async meshCurrent(r: MeshReport) {
        const input = { uri: r.snapshot.document.uri, projectRoot: r.snapshot.project.rootUri, units: r.snapshot.units === 'mm' && r.snapshot.inputKind !== '3mf' ? ('mm' as const) : undefined, exportSelection: r.snapshot.quality.exportSelection, tessellation: Object.fromEntries(Object.entries(r.snapshot.quality.requestedGlobalTessellation).map(([k, v]) => [k.slice(1), v])), requireNonEmpty: r.checks.some((c) => c.id === 'mesh-nonempty' && c.required) }
        const now = await this.cad.geometry!.capturePart(
            input,
            r.snapshot.dependencies.map((d) => vscode.Uri.parse(d.uri).fsPath),
        )
        return now.snapshot.sourceStateId === r.snapshot.sourceStateId && now.snapshot.inputEvidenceHash === r.snapshot.inputEvidenceHash
    }
    async resolve(id: string): Promise<EvidenceHandle> {
        this.trust()
        if (!/^cad-[a-f0-9-]{36}$/.test(id)) throw new CapabilityError('REPORT_NOT_FOUND', 'Invalid geometry report identity.')
        if (this.cad.verification.reports.get(id)) throw new CapabilityError('GEOMETRY_EVIDENCE_UNSUPPORTED', 'Diagnostics v1 has no frozen mesh. Explicitly verify geometry first.')
        let report: VerificationEvidence | undefined
        if (this.cad.assembly?.core.has(id)) report = this.cad.assembly.core.get(id)
        else
            try {
                report = this.cad.geometry!.core.get(id)
            } catch (e) {
                if (!(e instanceof CapabilityError) || e.code !== 'REPORT_NOT_FOUND') throw e
            }
        if (report) {
            const r = report
            await assertWorkspacePath(vscode.Uri.parse(r.snapshot.document.uri, true))
            const store = await this.storeForOwner(r.snapshot.document.uri)
            try {
                const release = this.cad.geometry!.artifacts.lease(rawRefs(r).map((a) => a.id))
                return { report: r, ownerUri: await this.canonical(r.snapshot.document.uri), store, read: (id) => this.cad.geometry!.artifacts.read(id), release, current: () => this.current(r) }
            } catch (e) {
                const saved = await store.get(id)
                if (!saved) throw e
                return this.saved(saved, store)
            }
        }
        for (const store of await this.activeStores()) {
            const bundle = await store.get(id)
            if (bundle) return this.saved(bundle, store)
        }
        throw new CapabilityError('REPORT_NOT_FOUND', 'Geometry evidence expired or was not retained. No source was compiled.')
    }
    private async saved(bundle: PersistedBundle, store: ReviewEvidenceStore): Promise<EvidenceHandle> {
        await assertWorkspacePath(vscode.Uri.parse(bundle.report.snapshot.document.uri, true), true)
        const release = store.lease(bundle.report.reportId)
        return { report: bundle.report, ownerUri: await this.canonical(bundle.report.snapshot.document.uri), store, read: (id) => store.readArtifact(bundle, id), release, current: () => this.current(bundle.report) }
    }
    async inputs(handle: EvidenceHandle, partIds?: Array<string | null>): Promise<SubjectInput[]> {
        const r = handle.report
        if (r.schemaVersion === 2) {
            if (partIds?.some((id) => id !== null)) throw new CapabilityError('PART_IDENTITY_CHANGED', 'Standalone mesh evidence has no declared stable part IDs.')
            const raw = r.artifacts.find((a) => a.role === 'raw')
            if (!raw) return []
            return [{ id: null, bytes: await handle.read(raw.id), format: raw.mimeType === 'model/3mf' ? '3mf' : 'stl', units: r.units }]
        }
        if (partIds?.some((id) => !r.snapshot.manifest?.parts.some((p) => p.id === id))) throw new CapabilityError('PART_NOT_FOUND', 'Choose a declared part ID in this report.')
        const inputs: SubjectInput[] = []
        let bytes = 0
        for (const s of r.snapshot.sources) {
            if (partIds && !partIds.includes(s.partId)) continue
            const raw = s.sourceReport.artifacts.find((a) => a.role === 'raw')
            if (!raw) continue
            const data = await handle.read(raw.id)
            bytes += data.length
            if (bytes > 128 * 1048576) throw new CapabilityError('REVIEW_INPUT_BUDGET', 'Review inputs exceed 128 MiB.')
            inputs.push({ id: s.partId, bytes: data, format: raw.mimeType === 'model/3mf' ? '3mf' : 'stl', units: 'mm', transform: s.transform, worldMatrix: r.facts?.parts.find((p) => p.id === s.partId)?.matrix })
        }
        return inputs
    }
    async retain(handle: EvidenceHandle, baseline: boolean, label?: string) {
        const world = handle.report.artifacts.filter((a) => a.mimeType === 'application/vnd.scad-ai-ide.world-mesh'),
            refs = [...rawRefs(handle.report), ...world]
        return handle.store.saveBundle({ schemaVersion: 1, report: handle.report, retainedArtifacts: refs, savedAt: Date.now(), label }, handle.read, baseline)
    }
}
