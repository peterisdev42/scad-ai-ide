// Development bootstrap only. Release packaging always runs build-lsp.cjs.
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
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
console.error('No runnable bundled OpenSCAD language server found. Install Rust stable, run git submodule update --init --recursive, then run npm run build:lsp to build sources/openscad-LSP.')
process.exit(1)
