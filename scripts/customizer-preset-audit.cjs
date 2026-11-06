// Characterize partial-preset selection without modifying the supplied JSON.
// Run after npm run compile-tests. Host I/O is injected; this is not a Host E2E.
const { readFileSync, writeFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { runInNewContext } = require('node:vm')
const path = require('node:path')

async function run() {
    const root = path.resolve(__dirname, '..')
    const { CustomizerService } = require(path.join(root, 'out/core/customizer/CustomizerService.js'))
    const service = new CustomizerService()
    service.load('file:///workspace/model.scad', 'width=10;\nheight=20;\n')
    const source = JSON.stringify({ fileFormatVersion: '1', extra: { keep: true }, parameterSets: { A: { width: '30' }, B: { height: '40' } } })
    const uri = { path: '/workspace/preset.json', toString: () => 'file:///workspace/preset.json' }
    const disposable = { dispose() {} }
    const listen = () => disposable
    const watcher = { dispose() {}, onDidCreate: listen, onDidChange: listen, onDidDelete: listen }
    const api = {
        Uri: { joinPath: () => uri },
        RelativePattern: class {},
        workspace: { fs: { readFile: async () => Buffer.from(source) }, createFileSystemWatcher: () => watcher },
    }
    const target = path.join(root, 'out/features/sidebar/CustomizerPresets.js')
    const module = { exports: {} }
    const requireFromTarget = createRequire(target)
    runInNewContext(readFileSync(target, 'utf8'), {
        module, exports: module.exports, Buffer,
        require: id => id === 'vscode' ? api : requireFromTarget(id),
    })
    const presets = new module.exports.CustomizerPresets(service, () => {})
    const results = []
    try {
        presets.bind(service.target)
        await presets.execute('import', undefined, uri)
        for (const name of ['A', 'B', '']) {
            await presets.execute('select', name)
            results.push({ selected: name || 'Design default', overrides: service.getOverrides(service.target), values: Object.fromEntries(service.parameters.map(p => [p.name, service.value(p)])) })
        }
    } finally { presets.dispose() }
    const report = { fixtureSource: source, io: 'injected-read-only', results, confirmedResidual: results[1].overrides.width === 30 }
    if (process.argv[2]) writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
