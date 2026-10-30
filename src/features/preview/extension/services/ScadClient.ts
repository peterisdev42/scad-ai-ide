import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { window, workspace } from 'vscode'
import { RuntimeUnavailableError } from '../../../../core/runtime/errors'
import type { LaunchCommand } from '../../../../core/runtime/types'
import { canPreviewSource, EmptyModelError, isEmptyModelOutput } from './previewEligibility'
import { ModelFormat } from '../../shared/types/ModelFormat'

/** All preview/export execution goes through the IDE's selected runtime. */
export class ScadClient {
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
        this.activeProcesses.clear()
        this.tickets.clear()
        this.resolveCommand = undefined
    }
    static cancelRender(key: string) {
        this.tickets.delete(key)
        const process = this.activeProcesses.get(key)
        if (process) {
            this.activeProcesses.delete(key)
            process.kill()
        }
    }
    static async render(scadPath: string, parameters: Record<string, string | number | boolean | number[]> = {}, format: ModelFormat = ModelFormat.STL, onStderr?: (chunk: string) => void, key = scadPath): Promise<Buffer> {
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
        const document = workspace.textDocuments.find((doc) => doc.uri.fsPath === scadPath)
        const text = document?.getText() ?? (await readFile(scadPath, 'utf8'))
        if (!canPreviewSource(text)) throw new EmptyModelError()
        if (format === ModelFormat.CSG && /\.csg$/i.test(scadPath)) {
            this.tickets.delete(key)
            return Buffer.from(text)
        }
        const source = document?.isDirty ? text : undefined
        const command = await this.resolveCommand?.()
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
            const args = [...command.argsPrefix, '--export-format', format, ...(workspace.getConfiguration('scad-ai-ide.preview').get<boolean>('enableLazyUnion', false) ? ['--enable', 'lazy-union'] : []), '-o', output, ...Object.entries(parameters).flatMap(([name, value]) => ['-D', `${name}=${JSON.stringify(value)}`]), ...(format === ModelFormat.CSG ? ['-D', '$preview=true'] : []), source === undefined ? scadPath : '-']
            this.outputChannel.appendLine(`[OpenSCAD] ${JSON.stringify([command.executable, ...args])}`)
            await new Promise<void>((resolve, reject) => {
                const child = spawn(command.executable, args, { cwd: dirname(scadPath), ...(format === ModelFormat.CSG ? { timeout: 30000, killSignal: 'SIGKILL' as const } : {}) })
                this.activeProcesses.set(key, child)
                let stderr = ''
                child.stdin.on('error', () => {})
                child.stdin.end(source)
                // Drain stdout as well: verbose CLI output must never block rendering.
                child.stdout.on('data', (data: Buffer) => this.outputChannel.append(data.toString()))
                child.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString()
                    stderr += chunk
                    this.outputChannel.append(chunk)
                    onStderr?.(chunk)
                })
                child.on('error', reject)
                child.on('close', (code) => {
                    const current = this.activeProcesses.get(key) === child
                    if (current) {
                        this.activeProcesses.delete(key)
                    }
                    if (!current) {
                        reject(new Error('Render cancelled'))
                    } else if (isEmptyModelOutput(stderr)) {
                        reject(new EmptyModelError())
                    } else if (code !== 0) {
                        reject(new Error(`OpenSCAD exited with code ${code}\n${stderr}`))
                    } else {
                        resolve()
                    }
                })
            })
            const buffer = await readFile(output)
            check()

            return buffer
        } finally {
            if (this.tickets.get(key) === ticket) {
                this.tickets.delete(key)
            }
            await rm(directory, { recursive: true, force: true })
        }
    }
}
