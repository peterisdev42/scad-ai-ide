import { readCliDependencies } from '../../core/formats/dependencies'
import { fontDirectoriesFromArgs } from '../../core/csg/fontDirectories'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchCommand } from '../../core/runtime/types'
import { compileCsg } from '../../core/csg/compile'
import type { CsgScene } from '../../core/csg/types'
import { ModelFormat } from '../preview/shared/types/ModelFormat'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'

import type { PreviewModel } from '../preview/shared/types/PreviewModel'

/** Markdown shares the native preview's CSG/mesh transport, never a screenshot. */
export async function renderScadModel(command: LaunchCommand, source: string, cwd: string, signal: AbortSignal, mode: PreviewMode = 'render', _publish?: (model: string) => void): Promise<string> {
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
        const model: PreviewModel = {previewMode:mode, format, content: buffer.toString('base64'), dependencies: csg?.dependencies ?? dependencies, backend: { kind: format === ModelFormat.CSG ? 'csg' : 'mesh', elapsedMs: Date.now() - started, timings: { cliMs, ...csg?.timings } } }
        // Built-in Markdown has no extension request channel. Ordinary F5 must
        // never enqueue a final boolean mesh. Exact tools use the managed
        // Markdown viewer, which has an explicit on-demand topology channel.
        return JSON.stringify(model)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
