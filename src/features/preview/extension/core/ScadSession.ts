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
    private syncingCustomizer = false
    private renderTimer: ReturnType<typeof setTimeout> | undefined
    private disposed = false
    private dependencyWatchers = new Map<string, Disposable>()
    private watchDependencies(buffer: Buffer, format: ModelFormat,dependencies?:{path:string;stamp:string}[]) {
        if (format !== ModelFormat.CSG&&!dependencies?.length) {
            for (const watcher of this.dependencyWatchers.values()) watcher.dispose()
            this.dependencyWatchers.clear()
            return
        }
        let paths: string[]
        try {
            paths = dependencies?.map(d=>d.path)??JSON.parse(buffer.toString('utf8')).dependencies.map((d: { path: string }) => d.path)
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
    public acceptPerformance(timings: PreviewTimings) {
        if (this.disposed) return
        const allowed: PreviewTimings = {}
        for (const key of ['cliMs', 'resourcesMs', 'geometryMs', 'normalizationMs', 'uploadMs', 'shaderMs', 'interactiveFrameMs'] as const) {
            const value = timings?.[key]
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) allowed[key] = value
        }
        this.renderBackend = { ...this.renderBackend, timings: { ...this.renderBackend.timings, ...allowed } }
        this._onBackendChanged.fire(this.renderBackend)
    }
    public acceptFrame(graphics: 'webgpu' | 'webgl2', firstFrameMs: number) {
        if (this.disposed) return
        this.renderBackend = { ...this.renderBackend, graphics, firstFrameMs, frameReady: true }
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
        void this.scadRenderer.render(this.documentUri.fsPath,this.scadParameters.getOverrides(),mode,true)
    }

    public get documentUri(): Uri {
        return this.document.uri
    }

    private refreshDocument() {
        if (this.disposed) return
        const parser = new ScadParser(this.document.getText())
        const saved = this.customizer.getOverrides(this.documentUri.toString())
        this.scadParameters.updateDefinitions(parser.parameters)
        if (!this.initialized) {
            this.initialized = true
            this.scadParameters.replaceOverrides(saved)
        }
        this.scadRenderer.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
    }
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
    ) {
        if (/\.csg$/i.test(this.documentUri.path)) this.selectedPreviewMode = 'preview'
        this.scadRenderer = new ScadRenderer({
            onBackendChange: (backend) => {
                this.renderBackend = backend
                this.customizer.setContinuousPreview(this.documentUri.toString(), this.previewMode === 'preview' && backend.kind === 'csg' && backend.frameReady === true)
                this._onBackendChanged.fire(backend)
            },
            onStart: () => this._onRenderStarted.fire(),
            onComplete: (data) => {
                this.watchDependencies(data.buffer, data.format,data.dependencies)
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
                this._onParametersChanged.fire(event)
            },
        })

        // A preset can arrive before the asynchronous file watcher has read the source.
        this.scadParameters.updateDefinitions(new ScadParser(document.getText()).parameters)
        this.scadParameters.replaceOverrides(customizer.getOverrides(this.documentUri.toString()))

        this.valuesSubscription = customizer.onDidChangeValues((target, reason) => {
            if (target !== this.documentUri.toString() || this.disposed) {
                return
            }
            const values = customizer.getOverrides(target)
            const changed = JSON.stringify(values) !== JSON.stringify(this.currentOverrides)
            if (changed) {
                this.syncingCustomizer = true
                try {
                    this.scadParameters.replaceOverrides(values)
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

        this.setupJsonWatcher()
    }

    private get jsonFileUri(): Uri {
        const jsonPath = this.documentUri.fsPath.replace(/\.scad$/i, '.json')
        if (jsonPath === this.documentUri.fsPath) {
            return Uri.file(jsonPath + '.json')
        }
        return Uri.file(jsonPath)
    }

    private setupJsonWatcher() {
        this.jsonWatcher = new FileWatcher({
            path: this.jsonFileUri.fsPath,
            onChange: async ({ content }) => {
                try {
                    const data = JSON.parse(content)
                    if (data && typeof data === 'object') {
                        data.parameterSets = data.parameterSets ?? {}
                        this.scadParameters.updateParameterSets(data.parameterSets)

                        const oldValues = JSON.stringify(this.scadParameters.getOverrides())
                        const activeSetName = this.scadParameters.getActiveSetName()
                        if (activeSetName) {
                            if (!(activeSetName in data.parameterSets)) {
                                this.applyParameterSet(undefined)
                            } else {
                                // Hot-reload the active set to ingest external JSON changes into the flat overrides bucket
                                this.scadParameters.setActiveSet(activeSetName)

                                if (JSON.stringify(this.scadParameters.getOverrides()) !== oldValues) {
                                    this.scadRenderer.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
                                }
                            }
                        }
                    }
                } catch {
                    // ignore parsing errors
                }
            },
        })

        this.loadJson()
    }

    private async loadJson() {
        try {
            const content = await workspace.fs.readFile(this.jsonFileUri)
            const data = JSON.parse(Buffer.from(content).toString('utf-8'))
            if (!this.disposed && data.parameterSets) {
                this.scadParameters.updateParameterSets(data.parameterSets)
            }
        } catch {
            // file doesn't exist or isn't valid JSON
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
        this.scadParameters.updateValue(name, value)

        this.scadRenderer.renderLatest(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
    }

    public async saveParameterSet(name: string) {
        const partial = this.scadParameters.calculateActiveSetPartial()

        let data: {
            parameterSets?: Record<string, Record<string, string>>
            fileFormatVersion?: string
            [key: string]: unknown
        } = {}
        try {
            const content = await workspace.fs.readFile(this.jsonFileUri)
            data = JSON.parse(Buffer.from(content).toString('utf-8'))
        } catch {
            // Create fresh structure if no existing explicit file
        }

        data.parameterSets = data.parameterSets || {}
        data.parameterSets[name] = partial
        data.fileFormatVersion = '1'

        await workspace.fs.writeFile(this.jsonFileUri, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'))
        this.scadParameters.updateParameterSets(data.parameterSets)
        this.scadParameters.setActiveSet(name)
    }

    public async deleteParameterSet(name: string) {
        if (this.scadParameters.getActiveSetName() === name) {
            this.applyParameterSet(undefined)
        }

        try {
            const content = await workspace.fs.readFile(this.jsonFileUri)
            const data = JSON.parse(Buffer.from(content).toString('utf-8'))
            if (data.parameterSets && data.parameterSets[name]) {
                delete data.parameterSets[name]
                await workspace.fs.writeFile(this.jsonFileUri, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'))
                this.scadParameters.updateParameterSets(data.parameterSets)
            }
        } catch {
            // ignore error if file doesn't exist
        }
    }

    public applyParameterSet(name: string | undefined) {
        this.scadParameters.setActiveSet(name)
        this.scadRenderer.render(this.documentUri.fsPath, this.scadParameters.getOverrides(), this.previewMode)
    }

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
        this.customizer.setContinuousPreview(this.documentUri.toString(), false)
        this._onBackendChanged.dispose()
        this._onRenderStarted.dispose()
        this._onRenderCompleted.dispose()
        this._onRenderError.dispose()
        this._onParametersChanged.dispose()
        this._onLog.dispose()
    }
}
