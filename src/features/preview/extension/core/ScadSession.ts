import type { CustomizerDomainService } from '../../../sidebar/CustomizerDomainService'
import { parsePresetFile } from '../../../../core/customizer/CustomizerPresets'
import { validPreviewTimings } from '../../../../core/preview/performance'
import type { CustomizerService } from '../../../../core/customizer/CustomizerService'
import { Disposable, EventEmitter, RelativePattern, TextDocument, Uri, workspace } from 'vscode'
import { dirname, basename } from 'node:path'
import { ModelFormat } from '../../shared/types/ModelFormat'
import { ScadParameter } from '../../shared/types/ScadParameter'
import { ScadClient } from '../services/ScadClient'
import { ScadParser } from '../services/ScadParser'
import { ScadRenderer } from '../services/ScadRenderer'
import { FileWatcher } from '../services/ScadWatcher'
import { ScadParameters } from './ScadParameters'
import type { PreviewBackend, PreviewTimings } from '../../shared/types/PreviewBackend'
import type { PreviewMode } from '../../shared/types/PreviewMode'

/**
 * Represents a single SCAD document session.
 * Decouples the file watching and parameter parsing from any specific Webview Panel UI.
 */
export class ScadSession {
    private scadWatcher: FileWatcher
    private documentSubscription: Disposable
    private valuesSubscription: { dispose(): void }
    private initialized = false
    private analysisComplete = true
    public get parameterAnalysisComplete() { return this.analysisComplete }
    private syncingCustomizer = false
    private renderTimer: ReturnType<typeof setTimeout> | undefined
    private disposed = false
    private dependencyWatchers = new Map<string, Disposable>()
    private watchDependencies(buffer: Buffer, format: ModelFormat, dependencies?: { path: string; stamp: string }[]) {
        if (format !== ModelFormat.PreviewScene && !dependencies?.length) {
            for (const watcher of this.dependencyWatchers.values()) watcher.dispose()
            this.dependencyWatchers.clear()
            return
        }
        let paths: string[]
        try {
            paths = dependencies?.map((d) => d.path) ?? JSON.parse(buffer.toString('utf8')).dependencies.map((d: { path: string }) => d.path)
        } catch {
            return
        }
        for (const [path, watcher] of this.dependencyWatchers)
            if (!paths.includes(path)) {
                watcher.dispose()
                this.dependencyWatchers.delete(path)
            }
        for (const path of paths)
            if (!this.dependencyWatchers.has(path)) {
                const watcher = workspace.createFileSystemWatcher(new RelativePattern(dirname(path), basename(path)))
                const refresh = () => {
                    this.scadRenderer.invalidateCache?.()
                    clearTimeout(this.renderTimer)
                    this.renderTimer = setTimeout(() => this.refreshRender(), 150)
                }
                const changed = watcher.onDidChange(refresh),
                    created = watcher.onDidCreate(refresh),
                    deleted = watcher.onDidDelete(refresh)
                this.dependencyWatchers.set(
                    path,
                    new Disposable(() => {
                        changed.dispose()
                        created.dispose()
                        deleted.dispose()
                        watcher.dispose()
                    }),
                )
            }
    }
    public renderBackend: PreviewBackend = { kind: 'pending' }
    private _onBackendChanged = new EventEmitter<PreviewBackend>()
    public readonly onBackendChanged = this._onBackendChanged.event
    private requestStartedAt = 0
    public acceptPerformance(timings: PreviewTimings) {
        if (this.disposed) return
        const allowed = validPreviewTimings(timings)
        this.renderBackend = { ...this.renderBackend, timings: { ...this.renderBackend.timings, ...allowed } }
        this._onBackendChanged.fire(this.renderBackend)
    }
    public acceptFrame(graphics: 'webgpu' | 'webgl2', firstFrameMs: number) {
        if (this.disposed) return
        this.renderBackend = { ...this.renderBackend, graphics, firstFrameMs, frameReady: true, timings: { ...this.renderBackend.timings, totalPreviewMs: Math.max(0, Date.now() - this.requestStartedAt) } }
        const total = this.renderBackend.timings?.totalPreviewMs ?? 0
        this.renderBackend.timings = { ...this.renderBackend.timings, firstFrameMs, transferSchedulingMs: Math.max(0, total - (this.renderBackend.timings?.cliMs ?? 0) - (this.renderBackend.timings?.watcherMs ?? 0) - (this.renderBackend.timings?.encodeMs ?? 0) - firstFrameMs) }
        if (this.renderBackend.kind === 'csg' || this.renderBackend.kind === 'mesh') ScadClient.outputChannel?.appendLine(`[Preview pipeline] ${JSON.stringify({ requestStartedAt: this.requestStartedAt, document: this.documentUri.toString(), kind: this.renderBackend.kind, graphics, cacheHit: !!this.renderBackend.cacheHit, timings: this.renderBackend.timings })}`)
        this.customizer.setContinuousPreview(this.documentUri.toString(), this.previewMode === 'preview' && this.renderBackend.kind === 'csg')
        this._onBackendChanged.fire(this.renderBackend)
    }

    private selectedPreviewMode?: PreviewMode

    public get previewMode(): PreviewMode {
        return this.selectedPreviewMode ?? workspace.getConfiguration('scad-ai-ide.preview', this.documentUri).get<PreviewMode>('renderMode', 'render')
    }

    public setPreviewMode(mode: PreviewMode) {
        if (this.disposed || (mode !== 'preview' && mode !== 'render') || mode === this.previewMode) return
        this.selectedPreviewMode = mode
        void this.scadRenderer.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), mode, true)
    }

    public get documentUri(): Uri {
        return this.document.uri
    }

    private refreshDocument() {
        if (this.disposed) return
        const parser = new ScadParser(this.document.getText())
        const saved = this.customizer.getOverrides(this.documentUri.toString())
        this.analysisComplete = parser.complete
        if (parser.complete) {
            this.syncingCustomizer = true
            try {
                this.scadParameters.updateDefinitions(parser.parameters)
                this.scadParameters.replaceOverrides(saved)
            } finally { this.syncingCustomizer = false }
            this.initialized = true
            this.customizer.replaceOverrides(this.documentUri.toString(), this.scadParameters.getOverrides())
        } else {
            // Retain the last complete definitions and all stored values during
            // temporary edits. No partial schema may prune the shared bucket.
            this.syncingCustomizer = true
            try { this.scadParameters.replaceOverrides(saved, false) }
            finally { this.syncingCustomizer = false }
        }
        this.scadRenderer.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
    }
    private presetSubscription?: Disposable
    private jsonWatcher?: FileWatcher
    private scadParameters: ScadParameters
    private scadRenderer: ScadRenderer

    // Events that Views can subscribe to
    private _onRenderCompleted = new EventEmitter<{
        buffer: Buffer
        format: ModelFormat
    }>()
    public readonly onRenderCompleted = this._onRenderCompleted.event

    private _onParametersChanged = new EventEmitter<{
        analysisComplete?: boolean
        parameters: ScadParameter[]
        parameterSets: Record<string, Record<string, string>>
        activeSetName: string | undefined
        overrides: Record<string, string | number | boolean | number[]>
    }>()
    public readonly onParametersChanged = this._onParametersChanged.event

    private _onRenderStarted = new EventEmitter<void>()
    public readonly onRenderStarted = this._onRenderStarted.event

    private _onRenderError = new EventEmitter<Error>()
    public readonly onRenderError = this._onRenderError.event

    private _onLog = new EventEmitter<string>()
    public readonly onLog = this._onLog.event

    constructor(
        private readonly document: TextDocument,
        private readonly customizer: CustomizerService,
        private readonly domain?: CustomizerDomainService,
    ) {
        if (/\.csg$/i.test(this.documentUri.path)) this.selectedPreviewMode = 'preview'
        this.scadRenderer = new ScadRenderer({
            onBackendChange: (backend) => {
                this.renderBackend = backend
                this.customizer.setContinuousPreview(this.documentUri.toString(), this.previewMode === 'preview' && backend.kind === 'csg' && backend.frameReady === true)
                this._onBackendChanged.fire(backend)
            },
            onStart: () => {
                this.requestStartedAt = Date.now()
                this._onRenderStarted.fire()
            },
            onComplete: (data) => {
                const watchersStarted = performance.now()
                this.watchDependencies(data.buffer, data.format, data.dependencies)
                this.acceptPerformance({ watcherMs: performance.now() - watchersStarted })
                this._onRenderCompleted.fire(data)
            },
            onError: (err) => this._onRenderError.fire(err),
            onLog: (chunk) => this._onLog.fire(chunk),
        })

        // Manager for current parameter values and overrides.
        this.scadParameters = new ScadParameters({
            onChange: (event) => {
                if (this.initialized && !this.syncingCustomizer) {
                    this.customizer.replaceOverrides(this.documentUri.toString(), event.overrides)
                }
                this._onParametersChanged.fire({ ...event, analysisComplete: this.analysisComplete })
            },
        })

        // A preset can arrive before the asynchronous file watcher has read the source.
        const initialParser = new ScadParser(document.getText())
        this.analysisComplete = initialParser.complete
        this.scadParameters.updateDefinitions(initialParser.parameters)
        this.scadParameters.replaceOverrides(customizer.getOverrides(this.documentUri.toString()), initialParser.complete)

        this.valuesSubscription = customizer.onDidChangeValues((target, reason) => {
            if (target !== this.documentUri.toString() || this.disposed) {
                return
            }
            const values = customizer.getOverrides(target)
            const changed = JSON.stringify(values) !== JSON.stringify(this.currentOverrides)
            if (changed) {
                this.syncingCustomizer = true
                try {
                    this.scadParameters.replaceOverrides(values, this.analysisComplete)
                } finally {
                    this.syncingCustomizer = false
                }
            }
            if (reason === 'preset') this.refreshRender()
            else if (reason === 'input') {
                if (changed && this.customizer.canPreviewContinuously(target)) this.scadRenderer.renderLatest(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode, 'input')
            } else if (changed || reason === 'commit') this.scadRenderer.renderLatest(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode, 'commit')
        })

        // Watcher for file changes.
        this.scadWatcher = new FileWatcher({
            path: this.documentUri.fsPath,
            onChange: () => this.refreshDocument(),
        })

        this.documentSubscription = workspace.onDidChangeTextDocument((event) => {
            if (event.document !== this.document || !event.contentChanges.length) return
            this.scadRenderer.invalidateCache?.()
            clearTimeout(this.renderTimer)
            this.renderTimer = setTimeout(() => this.refreshDocument(), 250)
        })

        this.presetSubscription = domain?.onDidChange(() => this.syncPresetBinding())
        this.setupJsonWatcher()
        this.syncPresetBinding()
    }

    private get jsonFileUri(): Uri {
        const jsonPath = this.documentUri.fsPath.replace(/\.scad$/i, '.json')
        if (jsonPath === this.documentUri.fsPath) {
            return Uri.file(jsonPath + '.json')
        }
        return Uri.file(jsonPath)
    }

    /** Discovery reads the sidecar only. All selections and writes use the host domain. */
    private syncPresetBinding(): boolean {
        if (!this.domain || this.domain.service.target !== this.documentUri.toString()) return false
        const state = this.domain.presets.state()
        if (!state.path) return false
        this.syncingCustomizer = true
        try { this.scadParameters.syncPresetState(this.domain.presets.parameterSets(), state.active || undefined) }
        finally { this.syncingCustomizer = false }
        return true
    }

    private acceptDiscoveredPresets(content: string) {
        if (this.disposed || this.syncPresetBinding()) return
        const data = parsePresetFile(content)
        this.syncingCustomizer = true
        try { this.scadParameters.syncPresetState(data.parameterSets, undefined) }
        finally { this.syncingCustomizer = false }
    }

    private setupJsonWatcher() {
        this.jsonWatcher = new FileWatcher({
            path: this.jsonFileUri.fsPath,
            onChange: async ({ content }) => {
                try { this.acceptDiscoveredPresets(content) }
                catch (error) { this._onLog.fire(`Preset reload failed; current values are preserved: ${(error as Error).message}`) }
            },
        })
        void this.loadJson()
    }

    private async loadJson() {
        try { this.acceptDiscoveredPresets(Buffer.from(await workspace.fs.readFile(this.jsonFileUri)).toString('utf8')) }
        catch (error) {
            if ((error as { code?: string }).code !== 'FileNotFound') this._onLog.fire(`Preset read failed; the original file is unchanged: ${(error as Error).message}`)
        }
    }

    public get currentParameters(): ScadParameter[] {
        return this.scadParameters.getParameters()
    }

    public get currentOverrides(): Record<string, string | number | boolean | number[]> {
        return this.scadParameters.getOverrides()
    }

    public get activeSetName(): string | undefined {
        return this.scadParameters.getActiveSetName()
    }

    public get currentParameterSets(): Record<string, Record<string, string>> {
        return this.scadParameters.getParameterSets()
    }

    public updateParameterValue(name: string, value: string | number | boolean | number[] | undefined) {
        if (this.domain) {
            const snapshot = this.domain.snapshot()
            if (value === undefined) this.domain.reset(this.documentUri.toString(), snapshot.revision, name)
            else this.domain.setValues(this.documentUri.toString(), snapshot.revision, { [name]: value })
            return
        }
        this.scadParameters.updateValue(name, value)

        this.scadRenderer.renderLatest(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
    }

    private async presetAction(action: 'select' | 'save' | 'delete', name?: string) {
        if (!this.domain) throw new Error('Customizer host domain is unavailable')
        const target = this.documentUri.toString()
        let snapshot = this.domain.snapshot()
        this.domain.assertTarget(target, snapshot.revision)
        // Discovery is read-only until an explicit user operation binds that file.
        if (!snapshot.presets.path && (name || action !== 'select')) {
            try {
                await workspace.fs.readFile(this.jsonFileUri)
                snapshot = await this.domain.preset(target, snapshot.revision, 'import', undefined, this.jsonFileUri)
            } catch (error) {
                if ((error as { code?: string }).code !== 'FileNotFound' || action !== 'save') throw error
            }
        }
        const operation = action === 'save' && name && !snapshot.presets.names.includes(name) ? 'new' : action
        await this.domain.preset(target, snapshot.revision, operation, name)
        this.syncPresetBinding()
    }

    public async saveParameterSet(name: string) { await this.presetAction('save', name) }
    public async deleteParameterSet(name: string) { await this.presetAction('delete', name) }
    public async applyParameterSet(name: string | undefined) { await this.presetAction('select', name) }

    public refreshRender() {
        if (!this.disposed) {
            this.scadRenderer.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
        }
    }

    public async exportFormat(format: ModelFormat): Promise<Buffer> {
        return ScadClient.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), format, undefined, `${this.documentUri.fsPath}:export:${crypto.randomUUID()}`)
    }

    public dispose() {
        if (this.disposed) return
        this.disposed = true
        clearTimeout(this.renderTimer)
        this.documentSubscription.dispose()
        for (const watcher of this.dependencyWatchers.values()) watcher.dispose()
        this.dependencyWatchers.clear()
        this.valuesSubscription.dispose()
        this.scadRenderer.dispose()
        ScadClient.cancelRender(this.documentUri.fsPath)
        this.scadWatcher.close()
        this.jsonWatcher?.close()
        this.presetSubscription?.dispose()
        this.customizer.setContinuousPreview(this.documentUri.toString(), false)
        this._onBackendChanged.dispose()
        this._onRenderStarted.dispose()
        this._onRenderCompleted.dispose()
        this._onRenderError.dispose()
        this._onParametersChanged.dispose()
        this._onLog.dispose()
    }
}
