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
    let occupiedSnapshot
    const round = async index => {
        let domain = new CustomizerSourceDomainService()
        let editor = new CustomizerEditorActions()
        const before = await collect()
        try {
            for (const document of documents) {
                const uri = document.uri.toString()
                const { identity } = await domain.analyze(uri)
                const plan = await domain.apply({ mode: 'plan', uri, identity, edits: [{ kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 0, max: 100, step: 5 } }] })
                editor.prepare(document, domain.plans.get(plan.planId), 'Host memory fixture')
            }
            const capacities = { cache: domain.cache.size, sourcePlans: domain.plans.size, editorPlans: editor.plans.size }
            assert.deepEqual(capacities, { cache: 16, sourcePlans: 32, editorPlans: 32 })
            const occupied = await collect()
            if (index === 1) occupiedSnapshot = await snapshot('occupied-round-one')
            domain.dispose()
            editor.dispose()
            assert.equal(domain.cache.size + domain.plans.size + editor.plans.size, 0)
            domain = undefined
            editor = undefined
            const released = await collect()
            return { round: index, capacities, before, occupied, afterDispose: released, releasedBytes: occupied.usedSize - released.usedSize }
        } finally { domain?.dispose(); editor?.dispose() }
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
        for (const document of documents) assert.equal(document.isDirty, false, 'The lifecycle benchmark never commits or saves an edit')
        await fsp.writeFile(path.join(directory, 'host-result.json'), JSON.stringify({
            scope: 'Real isolated VS Code Extension Host V8 heap; production source/editor classes, real TextDocuments and subscriptions. Does not profile renderer, GPU, every feature or every provider.',
            vscode: vscode.version, node: process.version, platform: process.platform, architecture: process.arch,
            sourceMode: 'Compiled production classes loaded in development Host; not a measurement of the installed minified bundle',
            documentCount: documents.length, sourceBytes: Buffer.byteLength(documents[0].getText()),
            warmup, samples, snapshots: { baseline, occupied: occupiedSnapshot, final }, savedOrCommitted: false,
        }, null, 2))
    } finally { session.disconnect() }
}
