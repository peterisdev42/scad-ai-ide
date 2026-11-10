import { PreviewOutput } from './renderDiagnostics'
import { libraryEnvironment } from '../../../../platform/libraries/LibraryEnvironment'
import type { PreviewTimings } from '../../../../core/preview/performance'
import { readCliDependencies, type FileDependency } from '../../../../core/formats/dependencies'
import { runExporter } from '../../../../platform/previewExporter/runtime'
import { resolvePreviewExporter } from './PreviewExporter'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { window, workspace } from 'vscode'
import { RuntimeUnavailableError } from '../../../../core/runtime/errors'
import type { LaunchCommand } from '../../../../core/runtime/types'
import { canPreviewSource, EmptyModelError, isEmptyModelOutput } from './previewEligibility'
import { ModelFormat } from '../../shared/types/ModelFormat'

/** All preview/export execution goes through the IDE's selected runtime. */
export class ScadClient {
    private static exporterControllers = new Map<string, AbortController>()
    private static tickets = new Map<string, symbol>()
    private static activeProcesses = new Map<string, ChildProcessWithoutNullStreams>()
    public static readonly outputChannel = window.createOutputChannel('SCAD AI IDE Preview')
    private static resolveCommand: (() => Promise<LaunchCommand>) | undefined

    static configure(resolve: () => Promise<LaunchCommand>) {
        this.resolveCommand = resolve
    }
    static dispose() {
        for (const process of this.activeProcesses.values()) {
            process.kill()
        }
        for (const controller of this.exporterControllers.values()) controller.abort()
        this.exporterControllers.clear()
        this.activeProcesses.clear()
        this.tickets.clear()
        this.resolveCommand = undefined
    }
    static cancelRender(key: string) {
        this.exporterControllers.get(key)?.abort()
        this.exporterControllers.delete(key)
        this.tickets.delete(key)
        const process = this.activeProcesses.get(key)
        if (process) {
            this.activeProcesses.delete(key)
            process.kill()
        }
    }
    static async render(scadPath: string, parameters: Record<string, string | number | boolean | number[]> = {}, format: ModelFormat | 'csg' = ModelFormat.STL, onStderr?: (chunk: string) => void, key = scadPath, onDependencies?: (dependencies: FileDependency[]) => void, signal?: AbortSignal, onTimings?: (timings: PreviewTimings) => void): Promise<Buffer> {
        this.cancelRender(key)
        const ticket = Symbol(key)
        this.tickets.set(key, ticket)
        const check = () => {
            if (this.tickets.get(key) !== ticket) {
                throw new Error('Render cancelled')
            }
        }
        if (!workspace.isTrusted) {
            throw new Error('Trust this workspace to run OpenSCAD.')
        }
        const sourceStarted = performance.now()
        const document = workspace.textDocuments.find((doc) => doc.uri.fsPath === scadPath)
        const text = document?.getText() ?? (await readFile(scadPath, 'utf8'))
        if (!canPreviewSource(text)) throw new EmptyModelError()
        onTimings?.({ sourceMs: performance.now() - sourceStarted })
        if (format === ModelFormat.PreviewScene) {
            const controller = new AbortController()
            this.exporterControllers.set(key, controller)
            const exporterSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
            try {
                const selectionStarted = performance.now()
                const executable = await resolvePreviewExporter()
                onTimings?.({ selectionMs: performance.now() - selectionStarted })
                check()
                const buffer = await runExporter(executable, text, dirname(scadPath), parameters, exporterSignal, scadPath, onStderr, onTimings)
                check()
                const resultStarted = performance.now()
                onDependencies?.(JSON.parse(buffer.toString()).dependencies)
                onTimings?.({ resultParseMs: performance.now() - resultStarted })
                return buffer
            } finally {
                if (this.exporterControllers.get(key) === controller) this.exporterControllers.delete(key)
                if (this.tickets.get(key) === ticket) this.tickets.delete(key)
            }
        }
        const source = document?.isDirty ? text : undefined
        const selectionStarted = performance.now()
        const command = await this.resolveCommand?.()
        onTimings?.({ runtimeSelectionMs: performance.now() - selectionStarted })
        check()
        if (!command) {
            throw new RuntimeUnavailableError()
        }
        if (!workspace.isTrusted) {
            throw new Error('Trust this workspace to run OpenSCAD.')
        }
        const directory = await mkdtemp(join(tmpdir(), 'scad-ai-preview-'))
        try {
            check()
            const output = join(directory, `model.${format}`)
            const dependencyFile = join(directory, 'model.d')
            const exportFormat = format === ModelFormat.STL ? 'binstl' : format
            const args = [...command.argsPrefix, '-d', dependencyFile, '--export-format', exportFormat, ...(workspace.getConfiguration('scad-ai-ide.preview').get<boolean>('enableLazyUnion', false) ? ['--enable', 'lazy-union'] : []), '-o', output, ...Object.entries(parameters).flatMap(([name, value]) => ['-D', `${name}=${JSON.stringify(value)}`]), source === undefined ? scadPath : '-']
            this.outputChannel.appendLine(`[OpenSCAD] ${JSON.stringify([command.executable, ...args])}`)
            const renderStarted = performance.now()
            const env = await libraryEnvironment.getEnvironment(scadPath)
            check()
            await new Promise<void>((resolve, reject) => {
                const child = spawn(command.executable, args, { cwd: dirname(scadPath), signal, env, shell: false })
                this.activeProcesses.set(key, child)
                const stderr = new PreviewOutput()
                let logged = 0
                const logLimit = 131072
                child.stdin.on('error', () => {})
                child.stdin.end(source)
                // Drain stdout as well: verbose CLI output must never block rendering.
                child.stdout.on('data', (data: Buffer) => this.outputChannel.append(data.toString()))
                child.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString()
                    stderr.append(chunk)
                    if (logged < logLimit) {
                        const bounded = chunk.slice(0, logLimit - logged)
                        this.outputChannel.append(bounded)
                        onStderr?.(bounded)
                        logged += bounded.length
                        if (logged === logLimit) {
                            this.outputChannel.appendLine('[OpenSCAD output truncated]')
                            onStderr?.('\n[OpenSCAD output truncated]\n')
                        }
                    }
                })
                child.on('error', reject)
                child.on('close', (code, terminationSignal) => {
                    const current = this.activeProcesses.get(key) === child
                    if (current) {
                        this.activeProcesses.delete(key)
                    }
                    if (!current) {
                        reject(new Error('Render cancelled'))
                    } else if (isEmptyModelOutput(stderr.text)) {
                        reject(new EmptyModelError())
                    } else if (code !== 0 || stderr.hasErrors) {
                        reject(new Error(`OpenSCAD exited with ${terminationSignal ? `signal ${terminationSignal}` : `code ${code}`}\n${stderr.text}`))
                    } else {
                        resolve()
                    }
                })
            })
            onTimings?.({ meshExportMs: performance.now() - renderStarted })
            const readStarted = performance.now()
            if (format === 'csg' && (await stat(output)).size > 2 * 1048576) throw new Error('CSG color metadata exceeds 2 MiB.')
            const buffer = await readFile(output)
            onTimings?.({ meshReadMs: performance.now() - readStarted })
            if (!buffer.length) throw new Error(`OpenSCAD produced an empty ${format} output. The selected runtime may not support this format.`)
            const dependenciesStarted = performance.now()
            const dependencies = await readCliDependencies(dependencyFile, dirname(scadPath), [scadPath])
            onTimings?.({ dependenciesMs: performance.now() - dependenciesStarted })
            check()
            onDependencies?.(dependencies)

            return buffer
        } finally {
            if (this.tickets.get(key) === ticket) {
                this.tickets.delete(key)
            }
            const cleanupStarted = performance.now()
            await rm(directory, { recursive: true, force: true })
            onTimings?.({ cleanupMs: performance.now() - cleanupStarted })
        }
    }
}
