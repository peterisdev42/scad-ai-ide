import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export class ReleaseError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

export function requireRelease(condition, message, code = 2) {
    if (!condition) throw new ReleaseError(code, message)
}

export function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex')
}

export function canonical(value) {
    function sort(item) {
        if (Array.isArray(item)) return item.map(sort)
        if (item !== null && typeof item === 'object') {
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]))
        }
        return item
    }
    return JSON.stringify(sort(value), null, 2) + '\n'
}

export function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
        throw new ReleaseError(2, 'Cannot read JSON input')
    }
}

export function writeJson(path, data, { immutable = false } = {}) {
    const tmp = join(dirname(path), `.release-${randomUUID()}.tmp`)
    try {
        const fd = openSync(tmp, 'wx', 0o600)
        try {
            writeFileSync(fd, canonical(data))
            fsyncSync(fd)
        } finally {
            closeSync(fd)
        }
        if (immutable) publishFile(tmp, path)
        else renameSync(tmp, path)
    } finally {
        rmSync(tmp, { force: true })
    }
}

export function publishFile(temp, destination) {
    try {
        linkSync(temp, destination)
    } catch (error) {
        if (error.code !== 'EEXIST') throw error
        requireRelease(lstatSync(destination).isFile() && readFileSync(temp).equals(readFileSync(destination)),
            'Immutable output already exists with different bytes', 4)
    }
}

function spawnCommand(program, args, { cwd, env = process.env, log = false, timeout = 0 }) {
    return spawnSync(program, args, { cwd, env, timeout, encoding: 'utf8',
        stdio: ['ignore', log ? 2 : 'pipe', log ? 2 : 'pipe'], maxBuffer: 16 * 1024 * 1024, windowsHide: true })
}

export function run(program, args, { code = 5, ...options } = {}) {
    const result = spawnCommand(program, args, options)
    requireRelease(result.status === 0, `${program} failed${result.error?.code ? ` (${result.error.code})` : ` (exit ${result.status ?? result.signal})`}`, code)
    return result.stdout ?? ''
}

// Git can echo credentials, repository paths and arbitrary remote or helper output.
// Emit only recognized diagnostics with fixed placeholders for untrusted values.
const gitDiagnostics = [
    [/^fatal: transport '(file|https|http|ssh|git)' not allowed$/, (_, protocol) => `fatal: transport '${protocol}' not allowed`],
    [/^fatal: transport .+ not allowed$/, 'fatal: transport <redacted> not allowed'],
    [/^fatal: repository .+ does not exist$/, 'fatal: repository <redacted> does not exist'],
    [/^fatal: .+ does not appear to be a git repository$/, 'fatal: <redacted> does not appear to be a git repository'],
    [/^fatal: not a git repository(?:: .+| \(or any of the parent directories\): .+)?$/, 'fatal: not a git repository'],
    [/^fatal: clone of .+ into submodule path .+ failed$/, 'fatal: clone into submodule path failed'],
    [/^fatal: (?:could not|cannot) chdir to .+$/, 'fatal: could not enter directory <redacted>'],
    [/^fatal: detected dubious ownership in repository at .+$/, 'fatal: detected dubious ownership in repository'],
    [/^fatal: No url found for submodule path .+ in .gitmodules$/, 'fatal: no URL found for submodule path in .gitmodules'],
    [/^fatal: Unable to find current revision in submodule path .+$/, 'fatal: unable to find current revision in submodule'],
    [/^fatal: Fetched in submodule path .+, but it did not contain .+$/, 'fatal: fetched submodule did not contain the requested revision'],
    [/^(?:fatal|error): .+: (Filename too long|Permission denied|No such file or directory|Invalid argument)$/, (_, reason) => `git: ${reason}`],
    [/^error: could not lock config file .+$/, 'error: could not lock config file <redacted>'],
    [/^fatal: could not read Username for .+$/, 'fatal: could not read remote username'],
    [/^fatal: Authentication failed for .+$/, 'fatal: authentication failed'],
]

function safeGitStderr(stderr) {
    const sanitized = new Set()
    for (const line of (stderr ?? '').split(/\r?\n/)) {
        if (!line.trim()) continue
        const rule = gitDiagnostics.find(([pattern]) => pattern.test(line))
        sanitized.add(rule ? line.replace(rule[0], rule[1]) : '<redacted Git stderr>')
    }
    return [...sanitized].join('\n')
}

export class GitCommandError extends ReleaseError {
    constructor(code, result) {
        const stderr = safeGitStderr(result.stderr)
        const failure = result.error?.code ?? (result.status === null ? result.signal : `exit ${result.status}`)
        super(code, `git failed (${failure})${stderr ? ': ' + stderr.replaceAll('\n', ' | ') : ''}`)
        this.git = { exitCode: result.status, signal: result.signal, spawnError: result.error?.code ?? null, stderr }
    }
}

export function gitRaw(cwd, args, code = 3) {
    const result = spawnCommand('git', args, { cwd, timeout: 60_000,
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' } })
    if (result.status !== 0) throw new GitCommandError(code, result)
    return result.stdout ?? ''
}

export const git = (cwd, args, code) => gitRaw(cwd, args, code).trim()

export function assertCommit(root, sha) {
    requireRelease(/^[a-f0-9]{40}$/.test(sha) && sha.length === 40 &&
        git(root, ['cat-file', '-t', sha], 2) === 'commit', 'Source must be an available full Git commit')
    return sha
}

export function runNpm(args, options) {
    const npmCli = options.env?.npm_execpath ?? process.env.npm_execpath
    if (npmCli && /\.[cm]?js$/i.test(npmCli)) return run(process.execPath, [npmCli, ...args], options)
    return run('npm', args, options)
}

export function attempt(program, args, { input, env = process.env, timeout = 10_000 } = {}) {
    return new Promise(resolve => {
        let stdout = ''
        const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'ignore'], env, timeout, killSignal: 'SIGKILL' })
        child.stdin.on('error', () => {})
        child.stdout.on('data', chunk => {
            stdout += chunk
            if (stdout.length > 1024 * 1024) child.kill()
        })
        child.once('error', () => resolve({ pass: false, stdout }))
        child.once('close', code => resolve({ pass: code === 0, stdout }))
        child.stdin.end(input)
    })
}
