import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import type { PreviewTimings } from '../../core/preview/performance'
import { readCliDependencies } from '../../core/formats/dependencies'
import { runExporter, resolveExporterExecutable } from '../../platform/previewExporter/runtime'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchCommand } from '../../core/runtime/types'
import type { PreviewScene } from '../../core/preview/types'
import { ModelFormat } from '../preview/shared/types/ModelFormat'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'

import type { PreviewModel } from '../preview/shared/types/PreviewModel'

/** Markdown shares the native preview's CSG/mesh transport, never a screenshot. */
export async function renderScadModel(command: LaunchCommand | undefined, source: string, cwd: string, signal: AbortSignal, mode: PreviewMode = 'render', _publish?: (model: string) => void): Promise<string> {
    const started = Date.now()
    const exportTimings: PreviewTimings = {}
    let model: PreviewModel
    signal.throwIfAborted()
    const directory = await mkdtemp(join(tmpdir(), 'scad-markdown-model-'))
    const run = async (format: ModelFormat): Promise<Buffer> => {
        if (!command) throw new Error('Select an OpenSCAD runtime for Full Render.')
        const output = join(directory, `model.${format}`)
        const exportFormat = format === ModelFormat.STL ? 'binstl' : format
        const args = [...command.argsPrefix, '-d', join(directory, 'model.d'), '--export-format', exportFormat, '-o', output, '-']
        const renderStarted = performance.now()
        const env = await libraryEnvironment.getEnvironment(join(cwd, '__markdown__.scad'))
        await new Promise<void>((resolve, reject) => {
            const child = execFile(command.executable, args, { cwd, env, signal, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => (error ? reject(new Error(stderr.trim().slice(-2000) || error.message)) : resolve()))
            child.stdin?.on('error', () => {})
            child.stdin?.end(source)
        })
        exportTimings.meshExportMs = performance.now() - renderStarted
        signal.throwIfAborted()
        const readStarted = performance.now()
        const buffer = await readFile(output)
        exportTimings.meshReadMs = performance.now() - readStarted
        if (!buffer.length) throw new Error('OpenSCAD produced an empty preview.')
        return buffer
    }
    try {
        const format = mode === 'preview' ? ModelFormat.PreviewScene : ModelFormat.STL
        const selectionStarted = performance.now()
        const exporter = mode === 'preview' ? await resolveExporterExecutable() : undefined
        if (exporter) exportTimings.selectionMs = performance.now() - selectionStarted
        const buffer = exporter ? await runExporter(exporter, source, cwd, {}, signal, undefined, undefined, (value) => Object.assign(exportTimings, value)) : await run(format)
        const dependencyStarted = performance.now()
        const dependencies = await readCliDependencies(join(directory, 'model.d'), cwd)
        if (!exporter) exportTimings.dependenciesMs = performance.now() - dependencyStarted
        const csg = format === ModelFormat.PreviewScene ? (JSON.parse(buffer.toString('utf8')) as PreviewScene) : undefined
        const encodeStarted = performance.now()
        const content = buffer.toString('base64')
        exportTimings.encodeMs = performance.now() - encodeStarted
        model = { previewMode: mode, format, content, dependencies: csg?.dependencies ?? dependencies, backend: { kind: format === ModelFormat.PreviewScene ? 'csg' : 'mesh', elapsedMs: Date.now() - started, timings: { ...csg?.timings, ...exportTimings } } }
    } finally {
        const cleanupStarted = performance.now()
        await rm(directory, { recursive: true, force: true })
        exportTimings.cleanupMs = (exportTimings.cleanupMs ?? 0) + performance.now() - cleanupStarted
    }
    model.backend!.elapsedMs = Date.now() - started
    Object.assign(model.backend!.timings!, exportTimings, { cliMs: model.backend!.elapsedMs })
    return JSON.stringify(model)
}
