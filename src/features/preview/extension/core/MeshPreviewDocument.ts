import { CustomDocument, Disposable, EventEmitter, RelativePattern, Uri, workspace } from 'vscode'
import { basename, dirname } from 'node:path'
import { ModelFormat } from '../../shared/types/ModelFormat'
import type { ScadParameter } from '../../shared/types/ScadParameter'
import type { PreviewSession } from './PreviewSession'
import { validPreviewTimings, type PreviewTimings } from '../../../../core/preview/performance'
import type { PreviewBackend } from '../../shared/types/PreviewBackend'

/** A mesh stays byte-for-byte intact. NEF3 needs a separate rendered copy. */
export class MeshPreviewDocument implements CustomDocument, PreviewSession {
    readonly currentParameters: ScadParameter[] = []
    readonly currentOverrides = {}
    readonly currentParameterSets = {}
    readonly activeSetName = undefined
    private readonly completed = new EventEmitter<{ buffer: Buffer; format: ModelFormat }>()
    private readonly started = new EventEmitter<void>()
    private readonly error = new EventEmitter<Error>()
    private readonly parameters = new EventEmitter<{ parameters: ScadParameter[]; parameterSets: Record<string, Record<string, string>>; activeSetName: string | undefined; overrides: Record<string, string | number | boolean | number[]> }>()
    private readonly log = new EventEmitter<string>()
    private readonly backendChanged = new EventEmitter<PreviewBackend>()
    readonly onBackendChanged = this.backendChanged.event
    renderBackend: PreviewBackend = { kind: 'mesh', source: 'mesh-file' }
    private requestStarted = 0
    readonly onRenderCompleted = this.completed.event
    readonly onRenderStarted = this.started.event
    readonly onRenderError = this.error.event
    readonly onParametersChanged = this.parameters.event
    readonly onLog = this.log.event
    private readonly subscriptions: Disposable[]
    private generation = 0
    private disposed = false
    private renderController?: AbortController
    get documentUri() {
        return this.uri
    }

    constructor(
        readonly uri: Uri,
        readonly sourceFormat: ModelFormat,
        private readonly renderNef3?: (signal: AbortSignal) => Promise<Buffer>,
    ) {
        const watcher = workspace.createFileSystemWatcher(new RelativePattern(dirname(uri.fsPath), basename(uri.fsPath)))
        const refresh = () => {
            void this.refreshRender()
        }
        this.subscriptions = [watcher, watcher.onDidChange(refresh), watcher.onDidCreate(refresh), watcher.onDidDelete(refresh)]
    }

    async refreshRender(): Promise<void> {
        if (this.disposed) return
        const generation = ++this.generation
        this.renderController?.abort()
        const controller = this.renderNef3 ? new AbortController() : undefined
        this.renderController = controller
        this.requestStarted = performance.now()
        this.renderBackend = { kind: 'mesh', source: 'mesh-file', timings: {} }
        this.backendChanged.fire(this.renderBackend)
        this.started.fire()
        try {
            const buffer = controller ? await this.renderNef3!(controller.signal) : await this.exportFormat(this.sourceFormat)
            if (!this.disposed && generation === this.generation) {
                const elapsed = performance.now() - this.requestStarted
                this.acceptPerformance(controller ? { meshExportMs: elapsed } : { meshReadMs: elapsed })
                this.completed.fire({ buffer, format: controller ? ModelFormat.STL : this.sourceFormat })
            }
        } catch (error) {
            if (!this.disposed && generation === this.generation) this.error.fire(error instanceof Error ? error : new Error(String(error)))
        } finally {
            if (this.renderController === controller) this.renderController = undefined
        }
    }

    acceptPerformance(timings: PreviewTimings) {
        if (this.disposed) return
        this.renderBackend = { ...this.renderBackend, timings: { ...this.renderBackend.timings, ...validPreviewTimings(timings) } }
        this.backendChanged.fire(this.renderBackend)
    }

    acceptFrame(graphics: 'webgpu' | 'webgl2', firstFrameMs: number) {
        if (this.disposed) return
        const totalPreviewMs = Math.max(0, performance.now() - this.requestStarted)
        this.renderBackend = { ...this.renderBackend, graphics, firstFrameMs, frameReady: true }
        this.acceptPerformance({ firstFrameMs, totalPreviewMs, transferSchedulingMs: Math.max(0, totalPreviewMs - (this.renderBackend.timings?.meshReadMs ?? 0) - (this.renderBackend.timings?.encodeMs ?? 0) - firstFrameMs) })
    }

    async exportFormat(format: ModelFormat): Promise<Buffer> {
        if (format !== this.sourceFormat) throw new Error('Mesh files can be exported in their original format only.')
        return Buffer.from(await workspace.fs.readFile(this.uri))
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        this.generation++
        this.renderController?.abort()
        for (const disposable of [...this.subscriptions, this.started, this.completed, this.error, this.parameters, this.log, this.backendChanged]) disposable.dispose()
    }
}
