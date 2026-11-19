import { readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const atomicJson = async (path, value) => {
    const temp = path + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temp, path)
}
export async function fingerprint(repo) {
    const files = []
    for (const folder of ['src', 'scripts', 'resources', 'skills', 'instructions', 'syntaxes', 'snippets', 'media', 'dist']) {
        for (const file of await readdir(join(repo, folder), { recursive: true })) {
            try {
                files.push([join(folder, file), sha256(await readFile(join(repo, folder, file)))])
            } catch (error) {
                if (error.code !== 'EISDIR') throw error
            }
        }
    }
    for (const file of ['package.json', 'package-lock.json', 'esbuild.js', '.vscode-test.mjs']) files.push([file, sha256(await readFile(join(repo, file)))])
    files.sort(([a], [b]) => a.localeCompare(b))
    return { id: sha256(JSON.stringify(files)), files: Object.fromEntries(files), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), branch: execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim() }
}
