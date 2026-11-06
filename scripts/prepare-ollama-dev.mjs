import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const extensionRoot = process.env.SCAD_VSCODE_EXTENSIONS_DIR ?? path.join(os.homedir(), '.vscode', 'extensions')
const explicitPath = process.env.SCAD_OLLAMA_EXTENSION_PATH
const candidates = explicitPath ? [path.resolve(explicitPath)] : (await readdir(extensionRoot).catch((error) => { if (error.code === 'ENOENT') return []; throw error })).filter((name) => /^ollama\.ollama(?:-|$)/i.test(name)).map((name) => path.join(extensionRoot, name))
const obsolete = explicitPath ? {} : await readFile(path.join(extensionRoot, '.obsolete'), 'utf8').then(JSON.parse).catch((error) => {
    if (error.code === 'ENOENT') return {}
    throw error
})
const installed = []
for (const directory of candidates) {
    if (obsolete[path.basename(directory)]) continue
    try {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
        if (`${manifest.publisher}.${manifest.name}`.toLowerCase() === 'ollama.ollama') installed.push({ directory, manifest })
    } catch (error) {
        if (explicitPath || !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    }
}
installed.sort((a, b) => b.manifest.version.localeCompare(a.manifest.version, 'en', { numeric: true }))
const source = installed[0]
if (!source) throw new Error('Ollama.ollama is not installed. Install the Ollama extension first, or set SCAD_OLLAMA_EXTENSION_PATH to its directory.')
if (source.manifest.extensionDependencies?.length) throw new Error(`Ollama now requires other extensions: ${source.manifest.extensionDependencies.join(', ')}. Review the allow-list before enabling them.`)

const root = path.join(workspace, '.build', 'ollama-dev')
const extensions = path.join(root, 'extensions')
// This is a generated allow-list directory, never the user's installed extension store.
await rm(extensions, { recursive: true, force: true })
await mkdir(extensions, { recursive: true })
const ollamaExtension = path.join(extensions, 'ollama.ollama')
await cp(source.directory, ollamaExtension, { recursive: true })
const result = { allowedExtension: 'Ollama.ollama', version: source.manifest.version, ollamaExtension, source: source.directory, extensions }
await writeFile(path.join(root, 'host.json'), JSON.stringify(result, null, 2) + '\n')
console.log(`Prepared ${result.allowedExtension} ${result.version}; only this installed extension is staged.`)
console.log(`Extensions: ${result.extensions}`)
