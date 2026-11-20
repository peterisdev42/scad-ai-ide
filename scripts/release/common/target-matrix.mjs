export const targets = Object.freeze({
    'darwin-arm64': { triple: 'aarch64-apple-darwin', executable: 'openscad-lsp', cross: ['build'] },
    'darwin-x64': { triple: 'x86_64-apple-darwin', executable: 'openscad-lsp', cross: ['build'] },
    'linux-x64': { triple: 'x86_64-unknown-linux-gnu', executable: 'openscad-lsp', cross: ['zigbuild'] },
    'win32-x64': { triple: 'x86_64-pc-windows-msvc', executable: 'openscad-lsp.exe', cross: ['xwin', 'build'] },
})

export const targetNames = Object.keys(targets)
export const hostTarget = `${process.platform}-${process.arch}`
export const lspPath = target => `server/${target}/${targets[target].executable}`
export const markets = ['vscode', 'openvsx']
