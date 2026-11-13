import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { digest } from '../../core/cad/snapshot'

/** Fingerprint possible literal include/use targets, including missing higher-priority files.
 * Existing dependency content hashes alone cannot detect a newly shadowing file.
 * Comments and strings are skipped; budgets prevent unbounded probing.
 */
export async function dependencyResolution(sources: Array<{ path: string; text: string }>, searchRoots: string[], permitted: (path: string) => boolean) {
    const candidates = new Set<string>()
    const unresolved: string[] = []
    for (const source of sources) {
        if (Buffer.byteLength(source.text) > 8 * 1048576) { unresolved.push('DEPENDENCY_RESOLUTION_SOURCE_LIMIT'); continue }
        for (const match of source.text.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|\b(?:include|use)\s*<([^>]+)>/g)) {
            const name = match[1]
            if (name === undefined) continue
            for (const root of [dirname(source.path), ...searchRoots]) {
                const candidate = isAbsolute(name) ? resolve(name) : resolve(root, name)
                if (candidates.size >= 2048 && !candidates.has(candidate)) { unresolved.push('DEPENDENCY_RESOLUTION_LIMIT'); break }
                candidates.add(candidate)
            }
        }
    }
    const facts = []
    for (const path of [...candidates].sort()) {
        if (!permitted(path)) { unresolved.push('DEPENDENCY_RESOLUTION_OUTSIDE_ROOTS'); facts.push({ path, status: 'outside' }); continue }
        try {
            const info = await lstat(path, { bigint: true }), canonical = await realpath(path)
            if (!permitted(canonical)) unresolved.push('DEPENDENCY_RESOLUTION_OUTSIDE_ROOTS')
            if (info.isSymbolicLink()) unresolved.push('DEPENDENCY_FILE_SYMLINK_RESOLUTION_UNPROVEN')
            facts.push({ path, canonical, mode: String(info.mode), size: String(info.size), ino: String(info.ino), mtime: String(info.mtimeNs), ctime: String(info.ctimeNs) })
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            facts.push({ path, status: code })
            if (code !== 'ENOENT' && code !== 'ENOTDIR') unresolved.push('DEPENDENCY_RESOLUTION_UNREADABLE')
        }
    }
    return { hash: digest(facts), paths: [...candidates].filter(permitted), unresolved: [...new Set(unresolved)] }
}
