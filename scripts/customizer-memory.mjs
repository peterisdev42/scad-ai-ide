import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

assert.equal(typeof global.gc, 'function', 'Run with node --expose-gc scripts/customizer-memory.mjs')
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), 'customizer-memory-'))
const require = createRequire(import.meta.url)
const listeners = new Set()
const listen = callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) } }
const documents = new Map()
const uri = value => {
    const url = new URL(value)
    return { scheme: url.protocol.slice(0, -1), path: fileURLToPath(url), fsPath: fileURLToPath(url), authority: url.host, query: url.search.slice(1), fragment: url.hash.slice(1), toString: () => url.href }
}
const api = {
    Uri: { parse: uri },
    workspace: {
        isTrusted: true,
        workspaceFolders: [{ uri: uri(pathToFileURL(directory).href) }],
        getWorkspaceFolder: candidate => candidate.fsPath.startsWith(directory + path.sep) ? {} : undefined,
        onDidChangeTextDocument: listen,
        onDidCloseTextDocument: listen,
        openTextDocument: async candidate => { const doc = documents.get(candidate.toString()); assert.ok(doc); return doc },
        fs: { isWritableFileSystem: () => true },
    },
}
const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['vscode'],
    stdin: { contents: "export { CustomizerSourceDomainService } from './src/features/sidebar/CustomizerSourceDomainService'; export { CustomizerEditorActions } from './src/features/language/CustomizerEditorActions'", resolveDir: root },
})
const module = { exports: {} }
runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, Buffer, URL, AbortController, setTimeout, clearTimeout,
    require: name => name === 'vscode' ? api : require(name),
})
const { CustomizerSourceDomainService, CustomizerEditorActions } = module.exports
const collect = async () => {
    await new Promise(resolve => setImmediate(resolve))
    global.gc()
    await new Promise(resolve => setImmediate(resolve))
    global.gc()
    return process.memoryUsage().heapUsed
}
const samples = []
try {
    // Real temporary file identity/path checks remain active. Only document and
    // event/provider ports are injected; no user files or heap contents are saved.
    for (let index = 0; index < 32; index++) {
        const target = uri(pathToFileURL(path.join(directory, `model-${index}.scad`)).href)
        const source = `width=40;\n// isolated memory fixture ${index} ` + 'geometry '.repeat(13000) + '\ncube(width);\n'
        await writeFile(target.fsPath, source)
        documents.set(target.toString(), { uri: target, version: 1, isClosed: false, getText: () => source, positionAt: offset => ({ line: 0, character: offset }) })
    }
    await collect()
    for (let round = 0; round < 7; round++) {
        const before = await collect()
        let domain = new CustomizerSourceDomainService()
        let editor = new CustomizerEditorActions()
        try {
            for (const [target, document] of documents) {
                const { identity } = await domain.analyze(target)
                const plan = await domain.apply({ mode: 'plan', uri: target, identity, edits: [{ kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 0, max: 100, step: 5 } }] })
                // Observe retained production state for this benchmark only.
                editor.prepare(document, domain.plans.get(plan.planId), 'Memory fixture edit')
            }
            assert.equal(domain.cache.size, 16)
            assert.equal(domain.plans.size, 32)
            assert.equal(editor.plans.size, 32)
            assert.equal(listeners.size, 3)
            const occupied = await collect()
            domain.dispose()
            editor.dispose()
            assert.equal(domain.cache.size + domain.plans.size + editor.plans.size + listeners.size, 0)
            domain = undefined
            editor = undefined
            const released = await collect()
            samples.push({ round, warmup: round === 0, heapBefore: before, heapOccupied: occupied, heapAfterDispose: released, releasedBytes: occupied - released })
        } finally { domain?.dispose(); editor?.dispose() }
    }
    const measured = samples.slice(1)
    console.log(JSON.stringify({
        scope: 'Production source/editor classes with injected document/event ports; not a full VS Code heap profile',
        node: process.version, platform: process.platform, architecture: process.arch,
        documentCount: 32, sourceBytes: Buffer.byteLength(documents.values().next().value.getText()),
        capacitiesVerified: { analysisCache: 16, sourcePlans: 32, editorPlans: 32 },
        listenersAfterEachDispose: 0,
        postDisposeHeapRangeBytes: Math.max(...measured.map(sample => sample.heapAfterDispose)) - Math.min(...measured.map(sample => sample.heapAfterDispose)),
        samples,
    }, null, 2))
} finally { documents.clear(); await rm(directory, { recursive: true, force: true }) }
