import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface FileDependency {
    path: string
    stamp: string
}
/** Read OpenSCAD's make dependency output, including escaped spaces and continuations. */
export async function readCliDependencies(file: string, cwd: string, exclude: string[] = []): Promise<FileDependency[]> {
    let source: string
    try {
        source = await readFile(file, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
    const body = source.replace(/\\\r?\n/g, ' '),
        separator = body.search(/:\s/)
    if (separator < 0) throw new Error('Invalid OpenSCAD dependency file.')
    const paths: string[] = [],
        tokens = body.slice(separator + 1).match(/(?:\\.|[^\s])+/g) ?? []
    for (const token of tokens) {
        const path = resolve(cwd, token.replace(/\\([\s#:\\])/g, '$1').replace(/\$\$/g, '$'))
        if (!exclude.includes(path) && !paths.includes(path)) paths.push(path)
    }
    return Promise.all(
        paths.map(async (path) => {
            const info = await stat(path)
            return { path, stamp: `${info.mtimeMs}:${info.size}` }
        }),
    )
}
