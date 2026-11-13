import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { digest } from '../../core/cad/snapshot'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import type { LaunchCommand } from '../../core/runtime/types'
import type { CadExecutionResult, CadParameters, ExecutionStatus } from '../../core/cad/types'
import { BoundedCliLog, normalizeCliDiagnostics } from '../../core/cad/diagnostics'
import { runtimeExecutableFiles } from './runtimeIdentity'
import { readCliDependencies } from '../../core/formats/dependencies'

export interface ExecutionRequest {
    command: LaunchCommand
    path: string
    source?: string
    parameters: CadParameters
    env: NodeJS.ProcessEnv
    format: 'csg' | 'stl' | '3mf' | 'png'
    signal?: AbortSignal
    timeoutMs?: number
    image?: { camera: number[]; projection: 'orthographic' | 'perspective'; size: [number, number]; fit: boolean }
    lazyUnion?: boolean
    onStderr?: (text: string) => void
}
export interface CliCapabilities {
    hash: string
    exportFormat: boolean
    dependencies: boolean
    output: boolean
    lazyUnion: boolean
    png: boolean
}
interface ProcessResult {
    status: ExecutionStatus
    code: number | null
    stdout: string
    stderr: string
    truncated: boolean
}

/** One bounded queue shared by diagnostics and CLI preview exports; no VS Code dependency. */
export class CadExecutionService {
    private active = 0
    private waiting: Array<{ start(): void; cancel(): void }> = []
    private controllers = new Set<AbortController>()
    private probes = new Map<string, CliCapabilities>()
    private disposed = false
    constructor(
        private readonly maxConcurrent = 1,
        private readonly maxQueued = 32,
    ) {}
    private async slot(signal: AbortSignal) {
        signal.throwIfAborted()
        if (this.active >= this.maxConcurrent) {
            if (this.waiting.length >= this.maxQueued) throw new CapabilityError('BUSY', 'CAD_QUEUE_FULL: CLI queue is full. Retry after a running operation completes.', true)
            await new Promise<void>((resolve, reject) => {
                const entry = {
                    start: () => {
                        signal.removeEventListener('abort', entry.cancel)
                        resolve()
                    },
                    cancel: () => {
                        this.waiting = this.waiting.filter((e) => e !== entry)
                        reject(new DOMException('CLI cancelled', 'AbortError'))
                    },
                }
                this.waiting.push(entry)
                signal.addEventListener('abort', entry.cancel, { once: true })
            })
        } else this.active++
        if (signal.aborted) {
            this.release()
            signal.throwIfAborted()
        }
    }
    private release() {
        const next = this.waiting.shift()
        if (next) next.start()
        else this.active--
    }
    private async process(command: LaunchCommand, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; source?: string; signal: AbortSignal; timeoutMs: number; onStderr?: (text: string) => void }): Promise<ProcessResult> {
        options.signal.throwIfAborted()
        return new Promise((resolve, reject) => {
            let status: ExecutionStatus = 'SUCCEEDED'
            const stdout = new BoundedCliLog(),
                stderr = new BoundedCliLog()
            const outDecoder = new StringDecoder('utf8'),
                errDecoder = new StringDecoder('utf8')
            let child: ChildProcessWithoutNullStreams
            try {
                child = spawn(command.executable, [...command.argsPrefix, ...args], { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, detached: process.platform !== 'win32' })
            } catch (error) {
                reject(error)
                return
            }
            let forceTimer: ReturnType<typeof setTimeout> | undefined
            const kill = (force = false) => {
                if (!child.pid) return
                try {
                    if (process.platform === 'win32') {
                        const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], { shell: false, windowsHide: true, stdio: 'ignore' })
                        killer.on('error', () => child.kill())
                    } else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
                } catch {
                    child.kill(force ? 'SIGKILL' : 'SIGTERM')
                }
            }
            const stop = (next: ExecutionStatus) => {
                if (status !== 'SUCCEEDED') return
                status = next
                kill()
                forceTimer = setTimeout(() => kill(true), 500)
                forceTimer.unref()
            }
            const cancel = () => stop('CANCELLED')
            const timeout = setTimeout(() => stop('TIMED_OUT'), options.timeoutMs)
            options.signal.addEventListener('abort', cancel, { once: true })
            if (options.signal.aborted) cancel()
            child.stdin.on('error', () => {})
            child.stdin.end(options.source)
            child.stdout.on('data', (data: Buffer) => stdout.append(outDecoder.write(data)))
            let streamed = 0
            child.stderr.on('data', (data: Buffer) => {
                const text = errDecoder.write(data)
                stderr.append(text)
                if (streamed < 65536) {
                    const chunk = text.slice(0, 65536 - streamed)
                    streamed += chunk.length
                    options.onStderr?.(chunk)
                }
            })
            const cleanup = () => {
                clearTimeout(timeout)
                clearTimeout(forceTimer)
                options.signal.removeEventListener('abort', cancel)
            }
            child.once('error', (error) => {
                cleanup()
                reject(error)
            })
            child.once('close', (code) => {
                if (status === 'CANCELLED' || status === 'TIMED_OUT') kill(true)
                cleanup()
                stdout.append(outDecoder.end())
                stderr.append(errDecoder.end())
                resolve({ status: status === 'SUCCEEDED' && code !== 0 ? 'FAILED' : status, code, stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated })
            })
        })
    }
    /** Help probing is per binary identity, bounded, and executed in the same host/environment. */
    private async capabilities(request: ExecutionRequest, signal: AbortSignal): Promise<CliCapabilities> {
        const key = (await runtimeExecutableFiles(request.command)).key
        const cached = this.probes.get(key)
        if (cached) return cached
        const result = await this.process(request.command, ['--help'], { cwd: dirname(request.path), env: request.env, signal, timeoutMs: Math.min(request.timeoutMs ?? 120000, 10000) })
        if (result.status === 'CANCELLED') throw new DOMException('CLI cancelled', 'AbortError')
        if (result.status === 'TIMED_OUT') throw new CapabilityError('TIMED_OUT', 'OpenSCAD capability probe timed out.', true)
        const help = result.stdout + result.stderr
        const capabilities = { hash: digest(help), exportFormat: help.includes('--export-format'), dependencies: /(?:^|\s)-d(?:\s|,)/m.test(help), output: /(?:^|\s)-o(?:\s|,)/m.test(help), lazyUnion: help.includes('lazy-union'), png: ['--camera', '--imgsize', '--projection', '--render', '--viewall'].every(flag => help.includes(flag)) }
        if (!capabilities.output) throw new CapabilityError('NOT_SUPPORTED', 'Selected runtime does not advertise CLI output support.')
        this.probes.set(key, capabilities)
        while (this.probes.size > 16) this.probes.delete(this.probes.keys().next().value!)
        return capabilities
    }
    async capabilityHash(command: LaunchCommand): Promise<string> {
        return this.probes.get((await runtimeExecutableFiles(command)).key)?.hash ?? 'unprobed'
    }
    async probe(request: ExecutionRequest): Promise<CliCapabilities> {
        if (this.disposed) throw new Error('CAD execution service disposed.')
        const abort = new AbortController()
        this.controllers.add(abort)
        const signal = request.signal ? AbortSignal.any([abort.signal, request.signal]) : abort.signal
        let acquired = false
        try {
            await this.slot(signal)
            acquired = true
            return await this.capabilities(request, signal)
        } finally {
            this.controllers.delete(abort)
            if (acquired) this.release()
        }
    }
    async execute(request: ExecutionRequest): Promise<CadExecutionResult> {
        if (this.disposed) throw new Error('CAD execution service disposed.')
        const abort = new AbortController()
        const signal = request.signal ? AbortSignal.any([abort.signal, request.signal]) : abort.signal
        this.controllers.add(abort)
        let acquired = false
        let directory: string | undefined
        const started = performance.now()
        const timings: NonNullable<CadExecutionResult['timings']> = {}
        let completed: CadExecutionResult | undefined
        try {
            await this.slot(signal)
            acquired = true
            const capability = await this.capabilities(request, signal)
            directory = await mkdtemp(join(tmpdir(), 'scad-ai-cad-'))
            const output = join(directory, `model.${request.format}`),
                dependencyFile = join(directory, 'model.d')
            const parameters = Object.entries(request.parameters)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .flatMap(([name, value]) => {
                    if (!/^[A-Za-z_$][\w$]*$/.test(name) || (typeof value === 'number' && !Number.isFinite(value)) || (Array.isArray(value) && (!value.every((v) => typeof v === 'number' && Number.isFinite(v)) || value.length > 1024))) throw new CapabilityError('INVALID_INPUT', 'Invalid OpenSCAD parameter.')
                    return ['-D', `${name}=${JSON.stringify(value)}`]
                })
            const image = request.image
            if (request.format === 'png' && (!capability.png || !image)) throw new CapabilityError('NOT_SUPPORTED', 'Runtime does not advertise the required PNG/camera capabilities.')
            if (image && (![6, 7].includes(image.camera.length) || image.camera.some(v => !Number.isFinite(v)) || !image.size.every(v => Number.isInteger(v) && v > 0 && v <= 1024) || !['orthographic','perspective'].includes(image.projection))) throw new CapabilityError('INVALID_INPUT', 'Invalid PNG camera or dimensions.')
            const imageArgs = image ? ['--render', '--camera', image.camera.join(','), '--projection', image.projection === 'orthographic' ? 'o' : 'p', '--imgsize', image.size.join(','), ...(image.fit ? ['--viewall', '--autocenter'] : [])] : []
            const args = [...imageArgs,...(capability.dependencies ? ['-d', dependencyFile] : []), ...(capability.exportFormat && request.format !== 'png' ? ['--export-format', request.format === 'stl' ? 'binstl' : request.format] : []), ...(request.lazyUnion && capability.lazyUnion ? ['--enable', 'lazy-union'] : []), '-o', output, ...parameters, request.source === undefined ? request.path : '-']
            const renderingStarted = performance.now()
            const result = await this.process(request.command, args, { cwd: dirname(request.path), env: request.env, source: request.source, signal, timeoutMs: request.timeoutMs ?? 120000, onStderr: request.onStderr })
            timings.meshExportMs = performance.now() - renderingStarted
            const emptyOutput = /^\s*Current top level object is empty\.\s*$/m.test(result.stderr) && !/^\s*(?:ERROR:|Parser error:)/im.test(result.stderr)
            const diagnostics = normalizeCliDiagnostics(result.stderr, emptyOutput || result.status === 'TIMED_OUT' || result.status === 'CANCELLED' ? 0 : result.code)
            let status = result.status
            if (status === 'SUCCEEDED' && diagnostics.some((d) => d.severity === 'error')) status = 'FAILED'
            const empty = emptyOutput && !diagnostics.some((d) => d.severity === 'error')
            const readingStarted = performance.now()
            let content: Buffer = Buffer.alloc(0)
            if (status === 'SUCCEEDED') {
                try {
                    const info = await stat(output)
                    if (info.size > (request.format === 'csg' ? 2 : request.format === 'png' ? 8 : 128) * 1048576) throw new Error('OpenSCAD output exceeds its byte budget.')
                    content = await readFile(output)
                    if (!content.length && !empty) throw new Error('OpenSCAD produced an empty output.')
                } catch (error) {
                    status = 'FAILED'
                    diagnostics.push({ code: 'SCAD_CLI_OUTPUT_INVALID', severity: 'error', message: error instanceof Error ? error.message : String(error), trace: [] })
                }
            }
            timings.meshReadMs = performance.now() - readingStarted
            const dependenciesStarted = performance.now()
            let dependencies: string[] = [],
                dependenciesComplete = false
            if (capability.dependencies) {
                try {
                    await stat(dependencyFile)
                    const rootPath = await realpath(request.path)
                    dependencies = (await readCliDependencies(dependencyFile, dirname(request.path), [request.path])).map((d) => d.path).filter((path) => path !== rootPath)
                    dependenciesComplete = true
                } catch {
                    /* Missing/partial dependency information never certifies a complete snapshot. */
                }
            }
            if (dependencies.length > 2048) {
                dependencies = dependencies.slice(0, 2048)
                dependenciesComplete = false
            }
            timings.dependenciesMs = performance.now() - dependenciesStarted
            completed = { timings, status, exitCode: result.code, content, diagnostics, dependencies, dependenciesComplete, log: `${result.stderr}\n[stdout]\n${result.stdout}`.slice(0, 262144), truncated: result.truncated, elapsedMs: performance.now() - started, empty }
            return completed
        } finally {
            const cleanupStarted = performance.now()
            this.controllers.delete(abort)
            try {
                if (directory) await rm(directory, { recursive: true, force: true })
            } finally {
                if (acquired) this.release()
                timings.cleanupMs = performance.now() - cleanupStarted
                if (completed) completed.elapsedMs = performance.now() - started
            }
        }
    }
    dispose() {
        this.disposed = true
        for (const abort of this.controllers) abort.abort()
        this.probes.clear()
    }
}

export const cadExecution = new CadExecutionService()
