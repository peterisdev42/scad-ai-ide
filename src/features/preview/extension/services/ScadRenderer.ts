import { memoryCaches } from '../../../../core/cache/CacheRegistry'
import { libraryEnvironment } from '../../../../platform/libraries/LibraryEnvironment'
import { stat } from 'node:fs/promises'
import { workspace } from 'vscode'
import { ModelFormat } from '../../shared/types/ModelFormat'
import { ScadClient } from './ScadClient'
import { EmptyModelError } from './previewEligibility'
import type { PreviewBackend } from '../../shared/types/PreviewBackend'
import type { PreviewMode } from '../../shared/types/PreviewMode'

type RenderParameters = Record<string, string | number | boolean | number[]>
interface RenderRequest {
    path: string
    parameters: RenderParameters
    mode: PreviewMode
    phase: 'input' | 'commit'
}

type OnStartCallback = () => void

type OnCompleteCallback = (data: { buffer: Buffer; format: ModelFormat; dependencies?: import('../../../../core/formats/dependencies').FileDependency[] }) => void

type OnErrorCallback = (error: Error) => void

export class ScadRenderer {
    private readonly results = new Map<string, { buffer: Buffer; format: ModelFormat; backend: PreviewBackend; dependencies: import('../../../../core/formats/dependencies').FileDependency[] }>()
    private readonly cacheInspector = memoryCaches.register('Preview render results', () => [...this.results].map(([key, result]) => ({ key, bytes: result.buffer.length, format: result.format, dependencies: result.dependencies })), () => this.invalidateCache())
    private cacheEpoch = 0
    public invalidateCache() {
        this.cacheEpoch++
        this.results.clear()
    }
    private active?: Promise<void>
    private pending?: RenderRequest
    private disposed = false
    private backend: PreviewBackend = { kind: 'pending' }
    private activeKey?: string
    private completedKey?: string
    private generation = 0
    private controller?: AbortController
    dispose() {
        this.cacheInspector.dispose()
        this.disposed = true
        this.results.clear()
        this.pending = undefined
        this.generation++
        this.controller?.abort()
    }
    private onStart?: OnStartCallback
    private onComplete: OnCompleteCallback
    private onError?: OnErrorCallback
    private onLog?: (chunk: string) => void

    private onBackendChange?: (backend: PreviewBackend) => void

    constructor({ onStart, onComplete, onError, onLog, onBackendChange }: { onBackendChange?: (backend: PreviewBackend) => void; onStart?: OnStartCallback; onComplete: OnCompleteCallback; onError?: OnErrorCallback; onLog?: (chunk: string) => void }) {
        this.onBackendChange = onBackendChange
        this.onStart = onStart
        this.onComplete = onComplete
        this.onError = onError
        this.onLog = onLog
    }

    /** Keep completed frames flowing during a drag; retain at most one waiting value. */
    public renderLatest(path: string, parameters: RenderParameters, mode: PreviewMode = 'render', phase: 'input' | 'commit' = 'commit') {
        if (this.disposed || !path || (phase === 'input' && (mode !== 'preview' || this.backend.kind !== 'csg'))) return
        const key = this.requestKey(path, parameters, mode)
        if (this.active) {
            if (key === this.activeKey && !this.controller?.signal.aborted) {
                this.pending = undefined
                return
            }
            // Input samples coalesce while the current frame completes, so a
            // continuous drag cannot starve the viewport. A committed value,
            // source edit or mode switch cancels obsolete execution immediately.
            if (phase === 'commit') {
                this.generation++
                this.controller?.abort()
            }
            this.pending = { path, parameters: Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value])), mode, phase }
        } else if (key !== this.completedKey) void this.startRender(path, parameters, mode)
    }

    private requestKey(path: string, parameters: RenderParameters, mode: PreviewMode) {
        return JSON.stringify([path, mode, workspace.getConfiguration('scad-ai-ide.preview').get<string>('exporterPath', ''), Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))])
    }

    private changeBackend(backend: PreviewBackend) {
        this.backend = backend
        this.onBackendChange?.(backend)
    }

    /** Source/mode changes take priority and cancel queued parameter updates. */
    public async render(path: string, parameters: RenderParameters, mode: PreviewMode = 'render', reuse = false) {
        if (this.disposed || !path) return
        if (!reuse) this.invalidateCache()
        this.pending = undefined
        this.completedKey = undefined
        this.changeBackend({ kind: 'pending' })
        await this.startRender(path, parameters, mode)
    }

    private async startRender(path: string, parameters: RenderParameters, mode: PreviewMode) {
        const key = this.requestKey(path, parameters, mode)
        this.activeKey = key
        const task = this.performRender(path, parameters, mode, key)
        this.active = task
        try {
            await task
        } finally {
            if (this.active === task) {
                this.active = undefined
                this.activeKey = undefined
                this.drainPending()
            }
        }
    }

    private drainPending() {
        const next = this.pending
        this.pending = undefined
        if (next) this.renderLatest(next.path, next.parameters, next.mode, next.phase)
    }

    private async performRender(path: string, parameters: RenderParameters, mode: PreviewMode, key: string) {
        const started = Date.now()
        const generation = ++this.generation,
            cacheEpoch = this.cacheEpoch
        this.controller?.abort()
        this.controller = new AbortController()
        const signal = this.controller.signal

        if (this.onStart) {
            this.onStart()
        }

        let format = mode === 'preview' ? ModelFormat.PreviewScene : workspace.getConfiguration('scad-ai-ide.preview').get<ModelFormat>('format', ModelFormat.STL)

        try {
            const cacheKey = key + ':' + await libraryEnvironment.getDependencyFingerprint(path)
            if (generation !== this.generation || signal.aborted) return
            const cached = this.results.get(cacheKey)
            if (cached) {
                const stamps = await Promise.all(
                    cached.dependencies.map(async (dependency) => {
                        try {
                            const info = await stat(dependency.path)
                            return `${info.mtimeMs}:${info.size}` === dependency.stamp
                        } catch {
                            return false
                        }
                    }),
                )
                if (generation !== this.generation) return
                if (stamps.every(Boolean)) {
                    this.completedKey = key
                    this.changeBackend({ ...cached.backend, elapsedMs: Date.now() - started, timings: { ...Object.fromEntries(Object.keys(cached.backend.timings ?? {}).map((key) => [key, 0])), cliMs: Date.now() - started }, cacheHit: true })
                    this.onComplete({ buffer: cached.buffer, format: cached.format, dependencies: cached.dependencies })
                    return
                }
                this.results.delete(cacheKey)
            }
            const pipelineTimings: import('../../shared/types/PreviewBackend').PreviewTimings = {}
            let dependencies: import('../../../../core/formats/dependencies').FileDependency[] = []
            let modelBuffer = await ScadClient.render(
                path,
                parameters,
                format,
                this.onLog,
                path,
                (value) => {
                    dependencies = value
                },
                signal,
                (timings) => {
                    if (generation !== this.generation) return
                    Object.assign(pipelineTimings, timings)
                    this.changeBackend({ kind: mode === 'preview' ? 'csg' : 'mesh', frameReady: this.backend.kind === 'csg' && this.backend.frameReady, timings: { ...pipelineTimings } })
                },
            )
            let timings: import('../../shared/types/PreviewBackend').PreviewTimings = { ...pipelineTimings }
            if (generation !== this.generation) return
            if (format === ModelFormat.PreviewScene) {
                try {
                    const metadataStarted = performance.now()
                    const scene = JSON.parse(modelBuffer.toString('utf8'))
                    timings = { ...timings, ...scene.timings, ...pipelineTimings }
                    dependencies = scene.dependencies ?? dependencies
                    timings.resultParseMs = (pipelineTimings.resultParseMs ?? 0) + performance.now() - metadataStarted
                } catch {
                    /* Telemetry never replaces the viewport's payload validation. */
                }
            }
            timings.cliMs = Date.now() - started
            if (generation === this.generation) {
                this.completedKey = key
                this.changeBackend({ kind: format === ModelFormat.PreviewScene ? 'csg' : 'mesh', elapsedMs: Date.now() - started, timings })
                if (cacheEpoch === this.cacheEpoch && modelBuffer.length <= 32 * 1048576) {
                    this.results.set(cacheKey, { buffer: modelBuffer, format, backend: this.backend, dependencies })
                    while (this.results.size > 2) this.results.delete(this.results.keys().next().value!)
                }
                this.onComplete({ buffer: modelBuffer, format, dependencies })
            }
        } catch (err) {
            if (generation !== this.generation || this.pending) {
                return
            }
            // Don't surface cancellations — they are intentional (a newer render
            // superseded this one) and should not be shown as errors to the user.
            if (err instanceof Error && err.message === 'Render cancelled') {
                return
            }

            if (mode === 'preview') this.changeBackend({ kind: 'unavailable', reason: err instanceof Error ? err.message : String(err), timings: this.backend.timings })
            if (this.onError) {
                this.onError(err instanceof Error && err.message === 'CSG model is empty.' ? new EmptyModelError() : err instanceof Error ? err : new Error(String(err)))
            }
        }
    }
}
