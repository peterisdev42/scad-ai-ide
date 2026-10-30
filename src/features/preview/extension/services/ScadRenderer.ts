import { workspace } from 'vscode'
import { ModelFormat } from '../../shared/types/ModelFormat'
import { ScadClient } from './ScadClient'
import { EmptyModelError } from './previewEligibility'
import type { PreviewBackend } from '../../shared/types/PreviewBackend'
import type { PreviewMode } from '../../shared/types/PreviewMode'
import { compileCsg } from '../../../../core/csg/compile'

type RenderParameters = Record<string, string | number | boolean | number[]>
interface RenderRequest {
    path: string
    parameters: RenderParameters
    mode: PreviewMode
    phase: 'input' | 'commit'
}

type OnStartCallback = () => void

type OnCompleteCallback = (data: { buffer: Buffer; format: ModelFormat }) => void

type OnErrorCallback = (error: Error) => void

export class ScadRenderer {
    private active?: Promise<void>
    private pending?: RenderRequest
    private disposed = false
    private backend: PreviewBackend = { kind: 'pending' }
    private activeKey?: string
    private completedKey?: string
    private generation = 0
    private controller?: AbortController
    dispose() {
        this.disposed = true
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
            if (key === this.activeKey) {
                this.pending = undefined
                return
            }
            this.pending = { path, parameters: Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value])), mode, phase }
        } else if (key !== this.completedKey) void this.startRender(path, parameters, mode)
    }

    private requestKey(path: string, parameters: RenderParameters, mode: PreviewMode) {
        return JSON.stringify([path, mode, Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))])
    }

    private changeBackend(backend: PreviewBackend) {
        this.backend = backend
        this.onBackendChange?.(backend)
    }

    /** Source/mode changes take priority and cancel queued parameter updates. */
    public async render(path: string, parameters: RenderParameters, mode: PreviewMode = 'render') {
        if (this.disposed || !path) return
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
        let fallbackReason: string | undefined
        const generation = ++this.generation
        this.controller?.abort()
        this.controller = new AbortController()
        const signal = this.controller.signal

        if (this.onStart) {
            this.onStart()
        }

        let format = mode === 'preview' ? ModelFormat.CSG : workspace.getConfiguration('scad-ai-ide.preview').get<ModelFormat>('format', ModelFormat.STL)

        try {
            let modelBuffer = await ScadClient.render(path, parameters, format, this.onLog)
            if (generation !== this.generation) return
            if (format === ModelFormat.CSG) {
                try {
                    modelBuffer = await compileCsg(modelBuffer.toString('utf8'), signal)
                } catch (error) {
                    signal.throwIfAborted()
                    if (!(error instanceof Error) || !error.message.startsWith('Unsupported CSG operation:')) throw error
                    fallbackReason = error.message.replace(/^Unsupported CSG operation:\s*/, '')
                    if (this.pending?.phase === 'input') this.pending = undefined
                    this.changeBackend({ kind: 'fallback', reason: fallbackReason })
                    this.onLog?.(`${error.message}; using the native mesh evaluator for this model.\n`)
                    format = ModelFormat.STL
                    modelBuffer = await ScadClient.render(path, { ...parameters, $preview: true }, format, this.onLog)
                }
            }
            if (generation === this.generation) {
                this.completedKey = key
                this.changeBackend({ kind: fallbackReason ? 'fallback' : format === ModelFormat.CSG ? 'csg' : 'mesh', reason: fallbackReason, elapsedMs: Date.now() - started })
                this.onComplete({ buffer: modelBuffer, format })
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

            if (this.onError) {
                this.onError(err instanceof Error && err.message === 'CSG model is empty.' ? new EmptyModelError() : err instanceof Error ? err : new Error(String(err)))
            }
        }
    }
}
