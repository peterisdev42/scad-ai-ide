// Development bootstrap only. Release packaging always runs build-lsp.cjs.
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, renameSync } = require('node:fs')
const { createHash } = require('node:crypto')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const name = process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp'
const destination = path.join(root, 'server', `${process.platform}-${process.arch}`, name)
const probe = (file) => {
    const version = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 5000 })
    const help = spawnSync(file, ['--help'], { encoding: 'utf8', timeout: 5000 })
    return version.status === 0 && help.status === 0 && help.stdout.includes('--stdio') ? version.stdout.trim() : undefined
}
if (existsSync(destination) && probe(destination)) {
    console.log(`OpenSCAD language server ready: ${destination}`)
    process.exit(0)
}
const cargo = spawnSync(process.env.CARGO || 'cargo', ['--version'], { encoding: 'utf8', timeout: 5000 })
if (cargo.status === 0) {
    const build = spawnSync(process.execPath, [path.join(__dirname, 'build-lsp.cjs')], { stdio: 'inherit' })
    process.exit(build.status ?? 1)
}
const cachedName = process.platform === 'win32' ? 'openscad-lsp.exe' : process.platform === 'linux' ? 'openscad-lsp-linux' : 'openscad-lsp'
const candidates = [path.resolve(root, '../openscad-support-vscode/server', cachedName), path.resolve(root, '../../.build/extensions/unpacked/openscad-support-vscode/server', cachedName)]
for (const candidate of candidates) {
    if (!existsSync(candidate)) {
        continue
    }
    const version = probe(candidate)
    if (!version) {
        continue
    }
    mkdirSync(path.dirname(destination), { recursive: true })
    const staged = `${destination}.${process.pid}.tmp`
    copyFileSync(candidate, staged)
    chmodSync(staged, 0o755)
    renameSync(staged, destination)
    copyFileSync(path.resolve(root, '../openscad-LSP/LICENSE-APACHE'), path.join(root, 'server', 'LICENSE-APACHE'))
    const provenance = { source: candidate, version, sha256: createHash('sha256').update(readFileSync(candidate)).digest('hex'), purpose: 'Local development fallback; use npm run build:lsp to replace with the current source build.' }
    writeFileSync(path.join(path.dirname(destination), 'provenance.json'), JSON.stringify(provenance, null, 4) + '\n')
    console.log(`Staged development fallback ${version}: ${destination}`)
    console.log('Cargo is unavailable. This cached binary may be older than sources/openscad-LSP. Release packaging always builds the current source.')
    process.exit(0)
}
console.error('No runnable OpenSCAD language server found. Install Rust stable and run npm run build:lsp, or set scad-ai-ide.languageServer.path to an installed server.')
process.exit(1)
