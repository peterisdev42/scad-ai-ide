// Build the checked-out sources/openscad-LSP submodule, then stage for this host.
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, renameSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'sources', 'openscad-LSP')
if (!existsSync(path.join(source, 'Cargo.toml'))) {
    console.error('Missing sources/openscad-LSP. Run git submodule update --init --recursive before building the server.')
    process.exit(1)
}
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
// Replace the inode rather than overwriting an executable whose code signature
// macOS may have cached from a previously launched development binary.
const staged = path.join(destination, `${name}.${process.pid}.tmp`)
copyFileSync(path.join(target, 'release', name), staged)
chmodSync(staged, 0o755)
renameSync(staged, path.join(destination, name))
rmSync(path.join(destination, 'provenance.json'), { force: true })
copyFileSync(path.join(source, 'LICENSE-APACHE'), path.join(root, 'server', 'LICENSE-APACHE'))
console.log(`Staged openscad-LSP in ${destination}`)
