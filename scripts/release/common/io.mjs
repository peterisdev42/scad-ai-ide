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

export function run(program, args, { cwd, env = process.env, log = false, code = 5, timeout = 0 } = {}) {
    const result = spawnSync(program, args, { cwd, env, timeout, encoding: 'utf8',
        stdio: ['ignore', log ? 2 : 'pipe', log ? 2 : 'pipe'], maxBuffer: 16 * 1024 * 1024, windowsHide: true })
    requireRelease(result.status === 0, `${program} failed${result.error?.code ? ` (${result.error.code})` : ` (exit ${result.status ?? result.signal})`}`, code)
    return result.stdout ?? ''
}

export function gitRaw(cwd, args, code = 3) {
    return run('git', args, { cwd, code, timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' } })
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
