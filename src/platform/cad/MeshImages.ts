import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { digest } from '../../core/cad/snapshot'
import { SharedTasks } from '../../core/cad/SharedTasks'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { runtimeExecutableFiles } from '../openscad/runtimeIdentity'
import { cadExecution } from '../openscad/CadExecutionService'
import type { LaunchCommand } from '../../core/runtime/types'
import type { ArtifactRef, Camera, MeshReport, RenderViewsInput } from '../../core/mesh/types'
import type { MeshArtifacts } from '../../core/mesh/VerificationService'
export interface RenderRuntime {
    command: LaunchCommand
    version: string
}
export interface ImageFrame {
    view: Camera
    artifact: ArtifactRef
    artifactUri: string
    renderSnapshotId: string
    sourceMeshSha256: string
    renderedMeshSha256: string
    camera: { arguments: number[]; projection: 'orthographic' | 'perspective'; framing: 'cli-autocenter-viewall' | 'explicit' }
    imageSize: [number, number]
    runtime: { identityHash: string; version: string }
    displayOnly: true
    coordinateQuantizationError: number
}
export interface RenderResult {
    reportId: string
    snapshotId: string
    current: boolean
    renderStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'SKIPPED'
    reasonCode?: string
    message?: string
    frames: ImageFrame[]
    delivery: 'metadata' | 'inline'
    deliveryReason?: string
    notExamined: string[]
}
async function fingerprint(runtime: RenderRuntime) {
    const files = await runtimeExecutableFiles(runtime.command)
    if (!files.complete) throw new CapabilityError('RUNTIME_IDENTITY_INCOMPLETE', 'Select a direct or managed official CLI for bound PNG evidence.')
    const identities = []
    for (const file of files.files) {
        const before = await stat(file, { bigint: true }),
            hash = createHash('sha256')
        if (before.size > 256n * 1048576n) throw new CapabilityError('RUNTIME_IDENTITY_INCOMPLETE', 'Runtime exceeds identification budget.')
        let bytes = 0
        for await (const data of createReadStream(file)) {
            bytes += data.length
            if (bytes > 256 * 1048576) throw new CapabilityError('RUNTIME_IDENTITY_INCOMPLETE', 'Runtime exceeds identification budget.')
            hash.update(data)
        }
        const after = await stat(file, { bigint: true })
        if (before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs || before.ino !== after.ino || before.size !== after.size) throw new CapabilityError('SNAPSHOT_CHANGED', 'PNG runtime changed during identification.', true)
        identities.push({ file, hash: hash.digest('hex') })
    }
    return digest({ command: runtime.command, version: runtime.version, identities, environment: process.env })
}
function camera(view: Camera, report: MeshReport) {
    if (typeof view === 'string') {
        const rotations: Record<string, number[]> = { iso: [55, 0, 25], front: [90, 0, 0], right: [90, 0, 90], top: [0, 0, 0] }
        if (!rotations[view]) throw new CapabilityError('INVALID_INPUT', 'Unknown camera preset.')
        const size = Math.max(...(report.facts?.bounds?.dimensions ?? [1, 1, 1])),
            distance = Math.max(1, size * 3)
        return { camera: [0, 0, 0, ...rotations[view], distance], projection: 'orthographic' as const, fit: true }
    }
    if (!view || !Array.isArray(view.eye) || !Array.isArray(view.target) || view.eye.length !== 3 || view.target.length !== 3 || [...view.eye, ...view.target].some((n) => typeof n !== 'number' || !Number.isFinite(n)) || Math.hypot(...view.eye.map((n, i) => n - view.target[i])) < 1e-12 || (view.projection && !['orthographic', 'perspective'].includes(view.projection))) throw new CapabilityError('INVALID_INPUT', 'Invalid explicit vector camera.')
    // The CLI owns its vector-camera up convention; exact axial views use gimbal presets.
    if (Math.hypot(view.eye[0] - view.target[0], view.eye[1] - view.target[1]) < 1e-12) throw new CapabilityError('INVALID_INPUT', 'Use the top preset for an axial top view.')
    return { camera: [...view.eye, ...view.target], projection: view.projection ?? 'perspective', fit: false }
}
/** CLI rasterization of an already frozen, raw-audited mesh; never re-evaluates user source. */
export class MeshImages {
    private readonly tasks = new SharedTasks<RenderResult>()
    private cache = new Map<string, { result: RenderResult; expires: number }>()
    private images = new Map<string, ArtifactRef>()
    constructor(
        private readonly artifacts: MeshArtifacts,
        private readonly directory: string,
        private readonly runtime: () => Promise<RenderRuntime | undefined>,
        private readonly current: (report: MeshReport) => Promise<boolean>,
    ) {}
    async render(report: MeshReport, input: RenderViewsInput, signal?: AbortSignal): Promise<RenderResult> {
        const size = input.imageSize ?? [512, 512],
            views = input.cameras ?? ['iso', 'front', 'top']
        if (!Array.isArray(size) || size.length !== 2 || size.some((n) => !Number.isInteger(n) || n < 1 || n > 1024) || !Array.isArray(views) || views.length < 1 || views.length > 4 || (input.delivery && !['metadata', 'inline'].includes(input.delivery))) throw new CapabilityError('INVALID_INPUT', 'Invalid PNG view count, dimensions or delivery.')
        const cameras = views.map((v) => camera(v, report)),
            result = (status: RenderResult['renderStatus'], code?: string, message?: string): RenderResult => ({ reportId: report.reportId, snapshotId: report.snapshot.id, current: false, renderStatus: status, reasonCode: code, message, frames: [], delivery: 'metadata', notExamined: ['visual-inspection', 'printability'] })
        if (report.facts?.rawTriangles === 0) return { ...result('SKIPPED', 'EMPTY_MESH'), current: await this.current(report) }
        const mesh = report.artifacts.find((a) => a.role === 'render') ?? report.artifacts.find((a) => a.role === 'raw' && a.mimeType === 'model/stl')
        if (!mesh || !report.facts?.bounds) return { ...result('UNAVAILABLE', 'MESH_DISPLAY_UNAVAILABLE', 'No supported frozen display mesh is available.'), current: await this.current(report) }
        const selected = await this.runtime()
        if (!selected) return { ...result('UNAVAILABLE', 'RUNTIME_UNAVAILABLE', 'PNG rendering requires a selected CLI; geometry measurements remain available.'), current: await this.current(report) }
        const runtime = structuredClone(selected)
        let identity: string
        try {
            identity = await fingerprint(runtime)
        } catch (error) {
            return { ...result('UNAVAILABLE', error instanceof CapabilityError ? error.code : 'RENDER_RUNTIME_UNAVAILABLE', error instanceof Error ? error.message : 'PNG runtime unavailable'), current: await this.current(report) }
        }
        signal?.throwIfAborted()
        for (const [key, value] of this.cache) if (value.expires <= Date.now()) this.cache.delete(key)
        const key = digest({ mesh: mesh.sha256, snapshot: report.snapshot.id, cameras, size, identity, version: 'official-cli-png-v1' })
        const cached = this.cache.get(key)
        if (cached) {
            try {
                for (const frame of cached.result.frames) await this.artifacts.read(frame.artifact.id)
            } catch (error) {
                this.cache.delete(key)
                throw error
            }
            return { ...structuredClone(cached.result), current: await this.current(report) }
        }
        const rendered = await this.tasks.run(
            key,
            async (active) => {
                const release = this.artifacts.lease([mesh.id]),
                    imageLeases: Array<() => void> = []
                let temp: string | undefined
                try {
                    const bytes = await this.artifacts.read(mesh.id)
                    temp = await mkdtemp(join(this.directory, 'render-'))
                    const file = join(temp, 'frozen.stl'),
                        path = join(temp, 'view.scad')
                    await writeFile(file, bytes, { mode: 0o600 })
                    await writeFile(path, '// generated frozen-artifact renderer\n', { mode: 0o600 })
                    const source = `import(${JSON.stringify(file)});`,
                        frames: ImageFrame[] = []
                    for (let i = 0; i < cameras.length; i++) {
                        active.throwIfAborted()
                        try {
                            const rendered = await cadExecution.execute({ command: runtime.command, path, source, parameters: { $preview: false }, format: 'png', env: { ...process.env }, signal: active, image: { ...cameras[i], size }, timeoutMs: 120000 })
                            if (rendered.status === 'CANCELLED') throw new DOMException('PNG cancelled', 'AbortError')
                            if (rendered.status !== 'SUCCEEDED') return result('UNAVAILABLE', 'PNG_RENDER_UNAVAILABLE', rendered.log.slice(0, 2048))
                            const header = Buffer.from(rendered.content.buffer, rendered.content.byteOffset, rendered.content.byteLength)
                            if (header.length < 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || header.readUInt32BE(16) !== size[0] || header.readUInt32BE(20) !== size[1]) return result('UNAVAILABLE', 'PNG_OUTPUT_INVALID', 'PNG header/dimensions do not match the bounded request.')
                            const png = PNG.sync.read(rendered.content, { checkCRC: true })
                            if (png.width !== size[0] || png.height !== size[1]) return result('UNAVAILABLE', 'PNG_OUTPUT_INVALID', 'PNG dimensions do not match the requested image size.')
                            const ref = await this.artifacts.put(report.snapshot.id, 'image', 'image/png', rendered.content)
                            imageLeases.push(this.artifacts.lease([ref.id]))
                            const renderSnapshotId = digest({ snapshot: report.snapshot.id, source: report.snapshot.meshSha256, mesh: mesh.sha256, camera: cameras[i], size, identity })
                            this.images.set(ref.id, ref)
                            frames.push({ view: views[i], artifact: ref, artifactUri: `scad-cad-artifact:/${ref.id}.png`, renderSnapshotId, sourceMeshSha256: report.snapshot.meshSha256!, renderedMeshSha256: mesh.sha256, camera: { arguments: cameras[i].camera, projection: cameras[i].projection, framing: cameras[i].fit ? 'cli-autocenter-viewall' : 'explicit' }, imageSize: size, runtime: { identityHash: identity, version: runtime.version }, displayOnly: true, coordinateQuantizationError: mesh.derivation?.maxCoordinateError ?? 0 })
                        } catch (error) {
                            if (active.aborted || (error as Error).name === 'AbortError') throw error
                            return result('UNAVAILABLE', error instanceof CapabilityError ? error.code : 'PNG_RENDER_UNAVAILABLE', error instanceof Error ? error.message : 'PNG backend unavailable')
                        }
                    }
                    const live = await this.runtime()
                    if (!live || (await fingerprint(live)) !== identity) throw new CapabilityError('SNAPSHOT_CHANGED', 'PNG runtime/environment changed during rendering.', true)
                    const completed: RenderResult = { ...result('AVAILABLE'), frames, current: await this.current(report) }
                    this.cache.set(key, { result: completed, expires: Date.now() + 1800000 })
                    while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
                    while (this.images.size > 512) this.images.delete(this.images.keys().next().value!)
                    return completed
                } finally {
                    imageLeases.forEach((release) => release())
                    release()
                    if (temp) await rm(temp, { recursive: true, force: true })
                }
            },
            signal,
        )
        return { ...structuredClone(rendered), current: await this.current(report) }
    }
    async payloads(result: RenderResult): Promise<Array<{ bytes: Uint8Array; mime: 'image/png' }>> {
        if (result.renderStatus !== 'AVAILABLE') return []
        if (result.frames.reduce((n, f) => n + f.artifact.bytes, 0) > 4 * 1048576) {
            result.deliveryReason = 'INLINE_PAYLOAD_LIMIT'
            return []
        }
        const release = this.artifacts.lease(result.frames.map((f) => f.artifact.id))
        try {
            return await Promise.all(result.frames.map(async (f) => ({ bytes: await this.artifacts.read(f.artifact.id), mime: 'image/png' as const })))
        } finally {
            release()
        }
    }
    async read(id: string) {
        const ref = this.images.get(id)
        if (!ref) throw new CapabilityError('ARTIFACT_NOT_FOUND', 'Image artifact expired or is not an image.')
        return this.artifacts.read(id)
    }
    dispose() {
        this.tasks.dispose()
        this.cache.clear()
        this.images.clear()
    }
}
