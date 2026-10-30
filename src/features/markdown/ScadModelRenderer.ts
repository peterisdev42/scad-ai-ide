import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchCommand } from '../../core/runtime/types'
import { compileCsg } from '../../core/csg/compile'
import { ModelFormat } from '../preview/shared/types/ModelFormat'
import type { PreviewMode } from '../preview/shared/types/PreviewMode'

import type { PreviewModel } from '../preview/shared/types/PreviewModel'

/** Markdown shares the native preview's CSG/mesh transport, never a screenshot. */
export async function renderScadModel(command: LaunchCommand, source: string, cwd: string, signal: AbortSignal, mode: PreviewMode = 'preview'): Promise<string> {
    const started = Date.now()
    signal.throwIfAborted()
    const directory = await mkdtemp(join(tmpdir(), 'scad-markdown-model-'))
    const run = async (format: ModelFormat): Promise<Buffer> => {
        const output = join(directory, `model.${format}`)
        const args = [...command.argsPrefix, '--export-format', format, '-o', output, ...(mode === 'preview' ? ['-D', '$preview=true'] : []), '-']
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
        let format = mode === 'preview' ? ModelFormat.CSG : ModelFormat.STL
        let buffer = await run(format)
        let note: string | undefined
        if (format === ModelFormat.CSG) {
            try {
                buffer = await compileCsg(buffer.toString('utf8'), signal)
            } catch (error) {
                signal.throwIfAborted()
                if (!(error instanceof Error) || !error.message.startsWith('Unsupported CSG operation:')) throw error
                note = `${error.message}; evaluated with the native mesh backend.`
                format = ModelFormat.STL
                buffer = await run(format)
            }
        }
        return JSON.stringify({ format, content: buffer.toString('base64'), note, backend: { kind: note ? 'fallback' : format === ModelFormat.CSG ? 'csg' : 'mesh', reason: note?.replace(/^Unsupported CSG operation:\s*/, ''), elapsedMs: Date.now() - started } } satisfies PreviewModel)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
