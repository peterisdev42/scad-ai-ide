// Build the checked-out sibling sources/openscad-LSP, then stage for this host.
const { spawnSync } = require('node:child_process')
const { mkdirSync, copyFileSync, chmodSync, rmSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.resolve(root, '../openscad-LSP')
const target = path.join(root, '.build', 'lsp')
const result = spawnSync(process.env.CARGO || 'cargo', ['build', '--locked', '--release', '--manifest-path', path.join(source, 'Cargo.toml'), '--target-dir', target], { stdio: 'inherit', cwd: source })
if (result.error || result.status !== 0) {
    console.error(result.error?.message || 'openscad-LSP build failed')
    console.error('Install the Rust stable toolchain (cargo) and initialize sources/openscad-LSP before building the server.')
    process.exit(1)
}
const name = process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp'
const destination = path.join(root, 'server', `${process.platform}-${process.arch}`)
mkdirSync(destination, { recursive: true })
copyFileSync(path.join(target, 'release', name), path.join(destination, name))
chmodSync(path.join(destination, name), 0o755)
rmSync(path.join(destination, 'provenance.json'), { force: true })
copyFileSync(path.join(source, 'LICENSE-APACHE'), path.join(root, 'server', 'LICENSE-APACHE'))
console.log(`Staged openscad-LSP in ${destination}`)
