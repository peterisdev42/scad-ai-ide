const vscode = require('vscode')
const assert = require('node:assert/strict')
const inspector = require('node:inspector')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

exports.run = async () => {
    const directory = process.env.SCAD_HOST_MEMORY_DIRECTORY
    assert.ok(directory, 'Supply the isolated memory evidence directory')
    const root = path.resolve(__dirname, '../..')
    const { CustomizerSourceDomainService } = require(path.join(root, 'out/features/sidebar/CustomizerSourceDomainService.js'))
    const { CustomizerEditorActions } = require(path.join(root, 'out/features/language/CustomizerEditorActions.js'))
    const includeGuiDomain = process.env.SCAD_HOST_MEMORY_GUI === '1'
    const { CustomizerService } = require(path.join(root, 'out/core/customizer/CustomizerService.js'))
    const { CustomizerDomainService } = require(path.join(root, 'out/features/sidebar/CustomizerDomainService.js'))
    const own = vscode.extensions.all.find(extension => extension.packageJSON.name === 'scad-ai-ide')
    await own.activate()
    assert.ok(vscode.workspace.isTrusted)
    assert.equal(vscode.workspace.workspaceFolders.length, 1)
    const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath
    assert.equal(await fsp.realpath(workspace), await fsp.realpath(path.join(directory, 'workspace')))
    const session = new inspector.Session()
    session.connect()
    const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
    const collect = async () => {
        await new Promise(resolve => setImmediate(resolve))
        await post('HeapProfiler.collectGarbage')
        await new Promise(resolve => setImmediate(resolve))
        await post('HeapProfiler.collectGarbage')
        return post('Runtime.getHeapUsage')
    }
    const snapshot = async name => {
        const file = path.join(directory, name + '.heapsnapshot')
        const descriptor = fs.openSync(file, 'w')
        const chunk = event => fs.writeSync(descriptor, event.params.chunk)
        session.on('HeapProfiler.addHeapSnapshotChunk', chunk)
        try { await post('HeapProfiler.takeHeapSnapshot', { reportProgress: false }) }
        finally { session.off('HeapProfiler.addHeapSnapshotChunk', chunk); fs.closeSync(descriptor) }
        return { file, bytes: fs.statSync(file).size }
    }
    const documents = []
    for (let index = 0; index < 32; index++) {
        const file = path.join(workspace, `memory-${index}.scad`)
        const source = `width=40;\n// memory fixture ${index} ` + 'geometry '.repeat(13000) + '\ncube(width);\n'
        await fsp.writeFile(file, source)
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file))
        assert.equal(document.getText(), source)
        documents.push(document)
    }
    const presetUri = vscode.Uri.file(path.join(workspace, 'memory-presets.json'))
    const presetBytes = JSON.stringify({ fileFormatVersion: '1', parameterSets: { A: { width: '45' } }, note: 'retained metadata '.repeat(7000) })
    if (includeGuiDomain) await fsp.writeFile(presetUri.fsPath, presetBytes)
    let occupiedSnapshot
    const round = async index => {
        let domain = new CustomizerSourceDomainService()
        let editor = new CustomizerEditorActions()
        let valueService = includeGuiDomain ? new CustomizerService() : undefined
        let guiDomain = valueService ? new CustomizerDomainService(valueService) : undefined
        const before = await collect()
        try {
            for (const document of documents) {
                const uri = document.uri.toString()
                const { identity } = await domain.analyze(uri)
                const plan = await domain.apply({ mode: 'plan', uri, identity, edits: [{ kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 0, max: 100, step: 5 } }] })
                editor.prepare(document, domain.plans.get(plan.planId), 'Host memory fixture')
                if (guiDomain) {
                    valueService.load(uri, document.getText())
                    guiDomain.presets.bind(uri)
                    await guiDomain.presets.execute('import', undefined, presetUri)
                    await guiDomain.presets.execute('select', 'A')
                    assert.equal(valueService.getOverrides(uri).width, 45)
                }
            }
            const capacities = { cache: domain.cache.size, sourcePlans: domain.plans.size, editorPlans: editor.plans.size }
            assert.deepEqual(capacities, { cache: 16, sourcePlans: 32, editorPlans: 32 })
            const guiCapacities = guiDomain ? { files: guiDomain.presets.files.size, overrides: valueService.overrides.size, valueListeners: valueService.listeners.size, previewListeners: valueService.previewListeners.size, watcher: !!guiDomain.presets.watcher } : undefined
            if (guiCapacities) assert.deepEqual(guiCapacities, { files: 32, overrides: 32, valueListeners: 1, previewListeners: 1, watcher: true })
            const occupied = await collect()
            if (index === 1) occupiedSnapshot = await snapshot('occupied-round-one')
            domain.dispose()
            editor.dispose()
            if (guiDomain) {
                guiDomain.dispose()
                assert.equal(guiDomain.presets.files.size, 0)
                assert.equal(guiDomain.presets.watcher, undefined)
                assert.equal(guiDomain.loadedSource, undefined)
                assert.equal(valueService.listeners.size + valueService.previewListeners.size, 0)
                assert.equal(valueService.getOverrides(valueService.target).width, 45, 'Disposal preserves the shared value service')
                guiDomain = undefined
                valueService = undefined
            }
            assert.equal(domain.cache.size + domain.plans.size + editor.plans.size, 0)
            domain = undefined
            editor = undefined
            const released = await collect()
            return { round: index, capacities, guiCapacities, before, occupied, afterDispose: released, releasedBytes: occupied.usedSize - released.usedSize }
        } finally { domain?.dispose(); editor?.dispose(); guiDomain?.dispose() }
    }
    try {
        // Warm the actual Host document/event paths before the baseline dump.
        const warmup = await round(0)
        await collect()
        const baseline = await snapshot('baseline')
        const samples = []
        for (let index = 1; index <= 6; index++) samples.push(await round(index))
        await collect()
        const final = await snapshot('after-six-rounds')
        if (includeGuiDomain) assert.equal(await fsp.readFile(presetUri.fsPath, 'utf8'), presetBytes, 'The lifecycle benchmark never writes the imported preset')
        for (const document of documents) assert.equal(document.isDirty, false, 'The lifecycle benchmark never commits or saves an edit')
        await fsp.writeFile(path.join(directory, 'host-result.json'), JSON.stringify({
            includeGuiDomain,
            scope: 'Real isolated VS Code Extension Host V8 heap; production source/editor classes and optional value/domain/preset classes, real TextDocuments, filesystem watchers and subscriptions. Does not profile renderer, GPU, every feature or every provider.',
            vscode: vscode.version, node: process.version, platform: process.platform, architecture: process.arch,
            sourceMode: 'Compiled production classes loaded in development Host; not a measurement of the installed minified bundle',
            documentCount: documents.length, sourceBytes: Buffer.byteLength(documents[0].getText()),
            warmup, samples, snapshots: { baseline, occupied: occupiedSnapshot, final }, savedOrCommitted: false,
        }, null, 2))
    } finally { session.disconnect() }
}
