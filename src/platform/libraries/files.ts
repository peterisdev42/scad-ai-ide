import { lock } from 'proper-lockfile'
import { mkdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { realpathSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
export function canonicalPath(directory: string): string {
    const suffix: string[] = []
    let current = path.resolve(directory)
    while (!existsSync(current)) {
        suffix.unshift(path.basename(current))
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    return path.join(realpathSync(current), ...suffix)
}
export const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
export async function readJson(file: string, fallback?: unknown): Promise<any> {
    try {
        return JSON.parse(await readFile(file, 'utf8'))
    } catch (e) {
        if (missing(e) && fallback !== undefined) return fallback
        throw e
    }
}
export async function atomicFile(file: string, contents: string) {
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
        await writeFile(temp, contents, { flag: 'wx' })
        await rename(temp, file)
    } finally {
        await rm(temp, { force: true })
    }
}
export async function atomicJson(file: string, value: unknown) {
    return atomicFile(file, JSON.stringify(value, null, 2) + '\n')
}
export async function exists(file: string) {
    try {
        await lstat(file)
        return true
    } catch (e) {
        if (missing(e)) return false
        throw e
    }
}
export async function ownedDirectory(directory: string) {
    await mkdir(directory, { recursive: true })
    if ((await lstat(directory)).isSymbolicLink() || path.resolve(await realpath(directory)) !== path.resolve(directory)) throw new Error(`Managed directory must not traverse a link: ${directory}`)
}
/** A heartbeat lease serializes extension hosts and recovers abandoned locks. */
export async function withLock<T>(directory: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await ownedDirectory(path.dirname(directory))
    const deadline = Date.now() + 60000
    let release: (() => Promise<void>) | undefined
    let compromised: Error | undefined
    while (!release) {
        signal?.throwIfAborted()
        try {
            release = await lock(path.dirname(directory), {
                lockfilePath: directory,
                stale: 30000,
                update: 5000,
                retries: 0,
                onCompromised: (error) => {
                    compromised = error
                },
            })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error
            if (Date.now() > deadline) throw new Error(`Library operation is busy. Retry later (${directory}).`)
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
    }
    try {
        signal?.throwIfAborted()
        const result = await work()
        if (compromised) throw compromised
        return result
    } finally {
        if (!compromised) await release()
    }
}
