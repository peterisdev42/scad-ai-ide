import { cp, lstat, realpath, symlink, unlink, rm } from 'node:fs/promises'
import type { LinkMode } from '../../core/libraries/types'
import { exists } from './files'
export class LibraryLinker {
    constructor(
        private readonly confirmCopy: (source: string) => Promise<boolean> = async () => false,
        private readonly platform = process.platform,
        private readonly link: typeof symlink = symlink,
    ) {}
    async create(source: string, destination: string): Promise<LinkMode> {
        if (await exists(destination)) throw new Error('Refusing to overwrite an existing dependency directory.')
        const mode = this.platform === 'win32' ? 'junction' : 'symlink'
        try {
            await this.link(await realpath(source), destination, mode === 'junction' ? 'junction' : 'dir')
            return mode
        } catch (error) {
            if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
            if (!(await this.confirmCopy(source))) throw new Error('Directory links are unavailable. Copy fallback was declined.')
            await cp(source, destination, { recursive: true, errorOnExist: true, force: false })
            return 'copy'
        }
    }
    async inspect(destination: string): Promise<{ mode: LinkMode | 'unknown'; target?: string; valid: boolean }> {
        if (!(await exists(destination))) return { mode: 'unknown', valid: false }
        const info = await lstat(destination)
        if (!info.isSymbolicLink()) return { mode: 'unknown', valid: info.isDirectory() }
        try {
            return { mode: this.platform === 'win32' ? 'junction' : 'symlink', target: await realpath(destination), valid: true }
        } catch {
            return { mode: this.platform === 'win32' ? 'junction' : 'symlink', valid: false }
        }
    }
    /** Only called after ownership validation by ProjectDependencyManager. */
    async remove(destination: string) {
        if (!(await exists(destination))) return
        if ((await lstat(destination)).isSymbolicLink()) await unlink(destination)
        else await rm(destination, { recursive: true })
    }
}
