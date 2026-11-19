import { mkdir, readFile, readdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEdits, modify, parse } from 'jsonc-parser'

const id = 'openai.chatgpt'
const installed = process.env.SCAD_VSCODE_EXTENSIONS_DIR ?? path.join(os.homedir(), '.vscode', 'extensions')
const missing = error => {
    if (error.code === 'ENOENT') return undefined
    throw error
}
const obsolete = await readFile(path.join(installed, '.obsolete'), 'utf8').then(JSON.parse).catch(missing) ?? {}
const entries = await readdir(installed).catch(missing) ?? []
const candidates = await Promise.all(entries.filter(entry => entry.toLowerCase().startsWith(id + '-') && !obsolete[entry]).map(async entry => {
    const directory = path.resolve(installed, entry)
    const manifest = await readFile(path.join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(missing)
    if (!manifest || `${manifest.publisher}.${manifest.name}`.toLowerCase() !== id) return undefined
    const platform = manifest.__metadata?.targetPlatform
    if (platform && !['universal', 'undefined', `${process.platform}-${process.arch}`].includes(platform)) return undefined
    return { directory, manifest }
}))
const source = candidates.filter(Boolean).sort((a, b) => b.manifest.version.localeCompare(a.manifest.version, 'en', { numeric: true }))[0]
if (!source) throw new Error(`Install the Codex VS Code extension (${id}) in ${installed}.`)
if (source.manifest.extensionDependencies?.length) throw new Error(`Codex requires other extensions: ${source.manifest.extensionDependencies.join(', ')}.`)

const root = fileURLToPath(new URL('../.build/codex-dev/', import.meta.url))
const extensions = path.join(root, 'extensions')
const staged = path.join(extensions, id)
await mkdir(extensions, { recursive: true })
await mkdir(path.join(root, 'installed'), { recursive: true })
const existing = await readlink(staged).catch(missing)
if (existing !== source.directory) {
    if (existing !== undefined) await unlink(staged)
    await symlink(source.directory, staged, 'junction')
}
// Route sessions in the isolated workbench through the native Chat view.
const profile = path.join(root, 'user-data', 'User')
const settingsPath = path.join(profile, 'settings.json')
await mkdir(profile, { recursive: true })
const existingSettings = await readFile(settingsPath, 'utf8').catch(missing) ?? '{}\n'
const errors = []
parse(existingSettings, errors)
if (errors.length) throw new Error(`Invalid VS Code settings in ${settingsPath}.`)
let settings = existingSettings
for (const key of ['chat.agentHost.codexAgent.enabled', 'chat.editor.codex.preferAgentHost']) {
    settings = applyEdits(settings, modify(settings, [key], true, { formattingOptions: { insertSpaces: true, tabSize: 4 } }))
}
if (settings !== existingSettings) await writeFile(settingsPath, settings)

console.log(`Prepared ${id} ${source.manifest.version} at ${staged}`)
