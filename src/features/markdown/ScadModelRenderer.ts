import { readCliDependencies } from '../../core/formats/dependencies'
import { fontDirectoriesFromArgs } from '../../core/csg/fontDirectories'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchCommand } from '../../core/runtime/types'
import { compileCsg, compileCsgTopology } from '../../core/csg/compile'
import { CSG_INTERACTIVE_WORK_LIMIT, estimateSceneRasterWork } from '../../core/csg/rasterWork'
import type { CsgGeometry, CsgScene } from '../../core/csg/types'
import { ModelFormat } from '../preview/shared/types/ModelFormat'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'

import type { PreviewModel } from '../preview/shared/types/PreviewModel'

/** Markdown shares the native preview's CSG/mesh transport, never a screenshot. */
export async function renderScadModel(command: LaunchCommand, source: string, cwd: string, signal: AbortSignal, mode: PreviewMode = 'render', _publish?: (model: string) => void, options: { prepareComplexTopology?: boolean } = {}): Promise<string> {
    const started = Date.now()
    signal.throwIfAborted()
    const directory = await mkdtemp(join(tmpdir(), 'scad-markdown-model-'))
    const run = async (format: ModelFormat): Promise<Buffer> => {
        const output = join(directory, `model.${format}`)
        const args = [...command.argsPrefix, '-d', join(directory, 'model.d'), '--export-format', format, '-o', output, ...(mode === 'preview' ? ['-D', '$preview=true'] : []), '-']
        await new Promise<void>((resolve, reject) => {
            const child = execFile(command.executable, args, { cwd, signal, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => (error ? reject(new Error(stderr.trim().slice(-2000) || error.message)) : resolve()))
            child.stdin?.on('error', () => {})
            child.stdin?.end(source)
        })
        signal.throwIfAborted()
        const buffer = await readFile(output)
        if (!buffer.length) throw new Error('OpenSCAD produced an empty preview.')
        return buffer
    }
    try {
        const format = mode === 'preview' ? ModelFormat.CSG : ModelFormat.STL
        let buffer = await run(format)
        const cliMs = Date.now() - started
        const dependencies = await readCliDependencies(join(directory, 'model.d'), cwd)
        if (format === ModelFormat.CSG) {
            buffer = await compileCsg(buffer.toString('utf8'), signal, { cwd, dependencies, fontDirectories: fontDirectoriesFromArgs(command.argsPrefix) })
        }
        const csg = format === ModelFormat.CSG ? (JSON.parse(buffer.toString('utf8')) as CsgScene) : undefined
        const model: PreviewModel = { previewMode: mode, format, content: buffer.toString('base64'), dependencies: csg?.dependencies ?? dependencies, backend: { kind: format === ModelFormat.CSG ? 'csg' : 'mesh', elapsedMs: Date.now() - started, timings: { cliMs, ...csg?.timings } } }
        // VS Code's built-in Markdown host cannot answer queryTopology messages.
        // For those code blocks only, make the *same* work-budget decision as
        // the interactive Stage, then attach one precomputed exact mesh.
        // Small/ordinary CSG blocks remain purely symbolic F5 previews.
        if (csg && options.prepareComplexTopology) {
            let shouldPrecompute = false
            try {
                shouldPrecompute = estimateSceneRasterWork(csg) > CSG_INTERACTIVE_WORK_LIMIT
            } catch {
                // Boundary-normalization failure also makes raster CSG unusable.
                shouldPrecompute = true
            }
            if (shouldPrecompute) {
                const topologyStarted = Date.now()
                try {
                    const topology: CsgGeometry = await compileCsgTopology(csg, signal)
                    signal.throwIfAborted()
                    model.topology = topology
                } catch (error) {
                    signal.throwIfAborted()
                    model.topologyError = error instanceof Error ? error.message : String(error)
                }
                model.backend!.timings = { ...model.backend!.timings, topologyMs: Date.now() - topologyStarted }
            }
        }
        model.backend!.elapsedMs = Date.now() - started
        return JSON.stringify(model)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
