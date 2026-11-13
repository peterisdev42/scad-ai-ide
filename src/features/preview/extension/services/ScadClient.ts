import { libraryEnvironment } from '../../../../platform/libraries/LibraryEnvironment'
import { cadExecution, type ExecutionRequest } from '../../../../platform/openscad/CadExecutionService'
import type { CadExecutionResult } from '../../../../core/cad/types'
import type { PreviewTimings } from '../../../../core/preview/performance'
import type { FileDependency } from '../../../../core/formats/dependencies'
import { runExporter } from '../../../../platform/previewExporter/runtime'
import { resolvePreviewExporter } from './PreviewExporter'
import { readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { window, workspace } from 'vscode'
import { RuntimeUnavailableError } from '../../../../core/runtime/errors'
import type { LaunchCommand } from '../../../../core/runtime/types'
import { canPreviewSource, EmptyModelError } from './previewEligibility'
import { ModelFormat } from '../../shared/types/ModelFormat'

type PrepareExecution = (request: ExecutionRequest) => Promise<((result: CadExecutionResult) => Promise<boolean>) | undefined>

/** Preview compatibility adapter; CLI ownership is shared with headless CAD analysis. */
export class ScadClient {
    private static controllers = new Map<string, AbortController>()
    private static tickets = new Map<string, symbol>()
    public static readonly outputChannel = window.createOutputChannel('SCAD AI IDE Preview')
    private static resolveCommand: (() => Promise<LaunchCommand>) | undefined
    private static prepareExecution: PrepareExecution | undefined
    static configure(resolve: () => Promise<LaunchCommand>, prepare?: PrepareExecution) {
        this.resolveCommand = resolve
        this.prepareExecution = prepare
    }
    static dispose() {
        for (const controller of this.controllers.values()) controller.abort()
        this.controllers.clear()
        this.tickets.clear()
        this.resolveCommand = undefined
        this.prepareExecution = undefined
    }
    static cancelRender(key: string) {
        this.controllers.get(key)?.abort()
        this.controllers.delete(key)
        this.tickets.delete(key)
    }
    static async render(scadPath: string, parameters: Record<string, string | number | boolean | number[]> = {}, format: ModelFormat | 'csg' = ModelFormat.STL, onStderr?: (chunk: string) => void, key = scadPath, onDependencies?: (dependencies: FileDependency[]) => void, signal?: AbortSignal, onTimings?: (timings: PreviewTimings) => void): Promise<Buffer> {
        this.cancelRender(key)
        const ticket = Symbol(key),
            controller = new AbortController()
        this.tickets.set(key, ticket)
        this.controllers.set(key, controller)
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        const check = () => {
            if (this.tickets.get(key) !== ticket || combined.aborted) throw new Error('Render cancelled')
        }
        try {
            if (!workspace.isTrusted) throw new Error('Trust this workspace to run OpenSCAD.')
            const started = performance.now()
            const document = workspace.textDocuments.find((doc) => doc.uri.fsPath === scadPath)
            const text = document?.getText() ?? (await readFile(scadPath, 'utf8'))
            if (!canPreviewSource(text)) throw new EmptyModelError()
            onTimings?.({ sourceMs: performance.now() - started })
            if (format === ModelFormat.PreviewScene) {
                const selectionStarted = performance.now(),
                    executable = await resolvePreviewExporter()
                onTimings?.({ selectionMs: performance.now() - selectionStarted })
                check()
                const buffer = await runExporter(executable, text, dirname(scadPath), parameters, combined, scadPath, onStderr, onTimings)
                check()
                onDependencies?.(JSON.parse(buffer.toString()).dependencies)
                return buffer
            }
            const selectionStarted = performance.now(),
                command = await this.resolveCommand?.()
            onTimings?.({ runtimeSelectionMs: performance.now() - selectionStarted })
            check()
            if (!command) throw new RuntimeUnavailableError()
            if (!workspace.isTrusted) throw new Error('Trust this workspace to run OpenSCAD.')
            const request: ExecutionRequest = { command, path: scadPath, source: document?.isDirty ? text : undefined, parameters, format: format === ModelFormat.STL ? 'stl' : format === ModelFormat.ThreeMF ? '3mf' : 'csg', env: await libraryEnvironment.getEnvironment(scadPath), signal: combined, lazyUnion: workspace.getConfiguration('scad-ai-ide.preview').get<boolean>('enableLazyUnion', false), onStderr }
            // Probe before capturing the snapshot so the same capabilities enter its identity.
            await cadExecution.probe(request)
            const publish = await this.prepareExecution?.(request)
            check()
            if (!workspace.isTrusted) throw new Error('Trust this workspace to run OpenSCAD.')
            const result = await cadExecution.execute(request)
            check()
            // A rejected stale report is still owned by this pipeline: never republish
            // the same outcome through the legacy buffer-only diagnostic adapter.
            await publish?.(result)
            check()
            onTimings?.(result.timings ?? { meshExportMs: result.elapsedMs })
            this.outputChannel.append(result.log.slice(0, 131072))
            if (result.status === 'CANCELLED') throw new Error('Render cancelled')
            if (result.empty) throw Object.assign(new EmptyModelError(), { cadReported: !!publish })
            if (result.status !== 'SUCCEEDED') throw Object.assign(new Error(`OpenSCAD exited with code ${result.exitCode}\n${result.log}`), { cadReported: !!publish })
            const dependencies = await Promise.all(
                result.dependencies.map(async (path) => {
                    const info = await stat(path)
                    return { path, stamp: `${info.mtimeMs}:${info.size}` }
                }),
            )
            onDependencies?.(dependencies)
            return result.content
        } finally {
            if (this.tickets.get(key) === ticket) this.tickets.delete(key)
            if (this.controllers.get(key) === controller) this.controllers.delete(key)
        }
    }
}
