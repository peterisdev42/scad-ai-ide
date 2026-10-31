import { readdir, readFile } from 'node:fs/promises'
import { delimiter, extname, join, resolve } from 'node:path'
import type { CsgResourceResolver, ResolvedCsgFont } from './resources.mjs'

const normalize = (value: string) =>
    value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s_-]/g, '')
/** Respect host font directories, including collections and explicit style names. */
export function withFontDirectories(base: CsgResourceResolver, directories: string[], cwd: string): CsgResourceResolver {
    const roots = [...new Set([...directories, ...(process.env.OPENSCAD_FONT_PATH ?? '').split(delimiter)].filter(Boolean).map((p) => resolve(cwd, p)))]
    let files: Promise<string[]> | undefined
    const list = async () => {
        const result: string[] = []
        const walk = async (path: string, depth: number) => {
            if (depth > 8) throw new Error('CSG font directory nesting budget exceeded.')
            const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
            for (const entry of entries) {
                if (result.length > 8192) throw new Error('CSG font directory file budget exceeded.')
                const child = join(path, entry.name)
                if (entry.isDirectory()) await walk(child, depth + 1)
                else if (entry.isFile() && /\.(ttf|otf|ttc|otc)$/i.test(extname(child))) result.push(child)
            }
        }
        for (const path of roots) await walk(path, 0)
        return result
    }
    const metadata = new Map<string, Awaited<ReturnType<(typeof import('./font.mjs'))['inspectFontFaces']>>>()
    const choose = async (pattern: string): Promise<ResolvedCsgFont | undefined> => {
        const families = pattern.split(':')[0].split(',').map(normalize),
            wanted = normalize(/:style=([^:]+)/i.exec(pattern)?.[1] ?? 'Regular')
        let best: { font: ResolvedCsgFont; score: number } | undefined
        for (const path of await (files ??= list())) {
            let faces = metadata.get(path)
            if (!faces) {
                const { inspectFontFaces } = await import('./font.mjs')
                try {
                    faces = await inspectFontFaces(await readFile(path))
                } catch {
                    continue
                }
                metadata.set(path, faces)
            }
            for (const face of faces) {
                const rank = families.indexOf(normalize(face.family))
                if (rank < 0) continue
                const style = normalize(face.style),
                    score = 100 - rank * 10 + (style === wanted ? 8 : style === 'regular' || style === 'book' ? 4 : 0)
                if (!best || score > best.score) best = { font: { path, index: face.index }, score }
            }
        }
        return best?.font
    }
    return {
        ...base,
        font: async (pattern) => {
            if (/\.(?:ttf|otf|ttc|otc)$/i.test(pattern)) return { path: resolve(cwd, pattern), index: 0 }
            const custom = roots.length ? await choose(pattern) : undefined
            if (custom) return custom
            return base.font(pattern)
        },
    }
}
