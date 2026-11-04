import * as path from 'node:path'
import { readFile, readdir, lstat, readlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { exists } from './files'
export function buildLibraryEnvironment(paths: string[], baseEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
    const separator = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter
    for (const directory of paths) if (directory.includes(separator)) throw new Error(`Library search paths cannot contain '${separator}'.`)
    const env = { ...baseEnv }
    if (!paths.length) return env
    const key = platform === 'win32' ? (Object.keys(env).find((key) => key.toUpperCase() === 'OPENSCADPATH') ?? 'OPENSCADPATH') : 'OPENSCADPATH'
    env[key] = [...paths, env[key]].filter(Boolean).join(separator)
    return env
}
export class LibraryEnvironment {
    private roots: () => string[] = () => []
    private events = new EventEmitter().setMaxListeners(0)
    configure(roots: () => string[]) {
        this.roots = roots
    }
    onDidChange(listener: (root: string) => void) {
        this.events.on('change', listener)
        return {
            dispose: () => {
                this.events.off('change', listener)
            },
        }
    }
    notifyChanged(root: string) {
        this.events.emit('change', root)
    }
    async resolveProjectRoot(sourceFile: string): Promise<string | undefined> {
        let current = path.dirname(path.resolve(sourceFile))
        const workspace = this.roots()
            .map((r) => path.resolve(r))
            .filter((r) => {
                const candidate = process.platform === 'win32' ? current.toLowerCase() : current
                const root = process.platform === 'win32' ? r.toLowerCase() : r
                return candidate === root || candidate.startsWith(root + path.sep)
            })
            .sort((a, b) => b.length - a.length)[0]
        while (true) {
            if (await exists(path.join(current, '.scad'))) return current
            if (workspace && (process.platform === 'win32' ? current.toLowerCase() === workspace.toLowerCase() : current === workspace)) return workspace
            const parent = path.dirname(current)
            if (parent === current) return workspace
            current = parent
        }
    }
    async getSearchPaths(sourceFile: string): Promise<string[]> {
        const root = await this.resolveProjectRoot(sourceFile)
        if (!root) return []
        const lib = path.join(root, '.scad', 'lib')
        if (!(await exists(lib))) return []
        if (lib.includes(path.delimiter)) throw new Error(`Project library path cannot contain '${path.delimiter}': ${lib}`)
        if ((await lstat(path.join(root, '.scad'))).isSymbolicLink() || (await lstat(lib)).isSymbolicLink()) throw new Error('Project library root must not be a link.')
        return [lib]
    }
    async getEnvironment(sourceFile: string, baseEnv: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
        const paths = await this.getSearchPaths(sourceFile)
        return buildLibraryEnvironment(paths, baseEnv)
    }
    async getDependencyFingerprint(sourceFile: string) {
        const root = await this.resolveProjectRoot(sourceFile)
        if (!root) return ''
        const hash = createHash('sha256')
        for (const file of ['dependencies.json', 'dependencies.lock.json', 'mounts.json']) {
            try {
                hash.update(await readFile(path.join(root, '.scad', file)))
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
                hash.update(`missing:${file}`)
            }
        }
        const lib = path.join(root, '.scad', 'lib')
        if (await exists(lib))
            for (const name of (await readdir(lib)).sort()) {
                const file = path.join(lib, name)
                const info = await lstat(file)
                hash.update(name + (info.isSymbolicLink() ? await readlink(file) : `${info.mtimeMs}:${info.size}`))
            }
        return hash.digest('hex')
    }
}
export const libraryEnvironment = new LibraryEnvironment()
