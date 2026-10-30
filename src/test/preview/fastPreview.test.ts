import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import * as vm from 'node:vm'
import { transformSync } from 'esbuild'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'
import * as eligibility from '../../features/preview/extension/services/previewEligibility'
import { RuntimeUnavailableError } from '../../core/runtime/errors'

test('SCAD fast preview uses CSG tree with dirty text and parameter overrides; mesh exports keep full evaluation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scad-fast-client-'))
    const script = join(directory, 'cli.cjs')
    const trace = join(directory, 'trace.json')
    const path = join(directory, 'model.scad')
    const source = 'width=20;\ndifference() { cube(width); sphere(5); }'
    const csg = Buffer.from('cube(size=[20,20,20], center=false);')
    const module = { exports: {} as { ScadClient: typeof import('../../features/preview/extension/services/ScadClient').ScadClient } }
    const require = createRequire(import.meta.url)
    const code = readFileSync(new URL('../../features/preview/extension/services/ScadClient.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        Buffer,
        require: (name: string) => {
            if (name === 'vscode')
                return {
                    workspace: { isTrusted: true, textDocuments: [{ uri: { fsPath: path }, isDirty: true, getText: () => source }], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
                    window: { createOutputChannel: () => ({ append() {}, appendLine() {} }) },
                }
            if (name.endsWith('/ModelFormat')) return { ModelFormat }
            if (name.endsWith('/runtime/errors')) return { RuntimeUnavailableError }
            if (name === './previewEligibility') return eligibility
            return require(name)
        },
    })
    const client = module.exports.ScadClient
    client.configure(async () => ({ executable: process.execPath, argsPrefix: [script, '--prefix'] }))
    try {
        await writeFile(path, 'cube(1);')
        await writeFile(
            script,
            `
const fs = require('node:fs'); const args = process.argv.slice(2); let source = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => source += chunk);
process.stdin.on('end', () => {
    const output = args[args.indexOf('-o')+1];
    const format = args[args.indexOf('--export-format')+1];
    fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({args, source, cwd: process.cwd(), output}));
    fs.writeFileSync(output, format === 'csg' ? Buffer.from(${JSON.stringify(csg.toString('base64'))}, 'base64') : Buffer.from('mesh:' + format));
});
`,
        )
        assert.deepEqual(await client.render(path, { width: 30 }, ModelFormat.CSG), csg)
        const first = JSON.parse(await readFile(trace, 'utf8'))
        assert.equal(first.source, source)
        assert.equal(first.args[0], '--prefix')
        assert.ok(first.args.includes('$preview=true'))
        assert.ok(first.args.includes('csg'))
        assert.ok(first.args.includes('width=30'))
        assert.equal(first.args.at(-1), '-')
        assert.ok(!first.args.includes('--render'))
        await assert.rejects(readFile(first.output), { code: 'ENOENT' })
        for (const format of [ModelFormat.STL, ModelFormat.ThreeMF]) {
            assert.equal((await client.render(path, { width: 30 }, format, undefined, `export:${format}`)).toString(), `mesh:${format}`)
            const exported = JSON.parse(await readFile(trace, 'utf8'))
            assert.ok(!exported.args.includes('$preview=true'), 'Exports must never use the CSG preview')
            assert.ok(exported.args.includes('width=30'))
        }
        const rawPath = join(directory, 'raw.CSG')
        await writeFile(rawPath, csg)
        client.configure(async () => {
            throw new Error('CSG files must not resolve a CLI for supported operations')
        })
        assert.deepEqual(await client.render(rawPath, {}, ModelFormat.CSG), csg)
    } finally {
        client.dispose()
        await rm(directory, { recursive: true, force: true })
    }
})

test('switching render mode suppresses obsolete results while selecting CSG or the configured mesh format', async () => {
    const calls: { format: ModelFormat; resolve: (data: Buffer) => void }[] = []
    const completed: ModelFormat[] = []
    const module = { exports: {} as { ScadRenderer: typeof import('../../features/preview/extension/services/ScadRenderer').ScadRenderer } }
    const source = readFileSync(new URL('../../features/preview/extension/services/ScadRenderer.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        AbortController,
        require: (name: string) => {
            if (name.endsWith('/csg/compile')) return { compileCsg: async () => Buffer.from('scene') }
            if (name === 'vscode') return { workspace: { getConfiguration: () => ({ get: () => ModelFormat.ThreeMF }) } }
            if (name.endsWith('/ModelFormat')) return { ModelFormat }
            if (name === './previewEligibility') return eligibility
            if (name === './ScadClient') return { ScadClient: { render: (_path: string, _parameters: unknown, format: ModelFormat) => new Promise<Buffer>((resolve) => calls.push({ format, resolve })) } }
            throw new Error(name)
        },
    })
    const renderer = new module.exports.ScadRenderer({ onComplete: ({ format }) => completed.push(format) })
    const old = renderer.render('/models/part.scad', {}, 'render')
    const fast = renderer.render('/models/part.scad', {}, 'preview')
    assert.deepEqual(
        calls.map((call) => call.format),
        [ModelFormat.ThreeMF, ModelFormat.CSG],
    )
    calls[1].resolve(Buffer.from('cube();'))
    await fast
    calls[0].resolve(Buffer.from('obsolete mesh'))
    await old
    assert.deepEqual(completed, [ModelFormat.CSG])
    renderer.dispose()
})

function queuedRenderer() {
    const calls: { parameters: Record<string, unknown>; format: ModelFormat; resolve: (data: Buffer) => void; reject: (error: Error) => void }[] = []
    const completed: string[] = [],
        errors: string[] = []
    const backends: import('../../features/preview/shared/types/PreviewBackend').PreviewBackend[] = []
    const module = { exports: {} as { ScadRenderer: typeof import('../../features/preview/extension/services/ScadRenderer').ScadRenderer } }
    const source = readFileSync(new URL('../../features/preview/extension/services/ScadRenderer.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        AbortController,
        Error,
        require: (name: string) => {
            if (name.endsWith('/csg/compile'))
                return {
                    compileCsg: async (source: string) => {
                        if (source === 'unsupported') throw new Error('Unsupported CSG operation: non-triangular polyhedron face')
                        return Buffer.from(source)
                    },
                }
            if (name === 'vscode') return { workspace: { getConfiguration: () => ({ get: () => ModelFormat.STL }) } }
            if (name.endsWith('/ModelFormat')) return { ModelFormat }
            if (name === './previewEligibility') return eligibility
            if (name === './ScadClient') return { ScadClient: { render: (_path: string, parameters: Record<string, unknown>, format: ModelFormat) => new Promise<Buffer>((resolve, reject) => calls.push({ parameters, format, resolve, reject })) } }
            throw new Error(name)
        },
    })
    const renderer = new module.exports.ScadRenderer({ onBackendChange: (backend) => backends.push(backend), onComplete: ({ buffer }) => completed.push(buffer.toString()), onError: (error) => errors.push(error.message) })
    return { renderer, calls, completed, errors, backends }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test('continuous parameter changes show completed frames and retain only the latest waiting value', async () => {
    const { renderer, calls, completed } = queuedRenderer()
    renderer.renderLatest('/part.scad', { width: 1 }, 'preview')
    for (let width = 2; width <= 30; width++) renderer.renderLatest('/part.scad', { width }, 'preview')
    assert.equal(calls.length, 1, 'Dragging must not continually cancel/restart the active CLI job')
    calls[0].resolve(Buffer.from('width 1'))
    await flush()
    assert.deepEqual(completed, ['width 1'], 'An intermediate result is needed while the pointer is still held')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].parameters.width, 30)
    renderer.renderLatest('/part.scad', { width: 31 }, 'preview')
    renderer.renderLatest('/part.scad', { width: 40 }, 'preview')
    calls[1].resolve(Buffer.from('width 30'))
    await flush()
    assert.deepEqual(completed, ['width 1', 'width 30'])
    assert.equal(calls[2].parameters.width, 40)
    calls[2].resolve(Buffer.from('width 40'))
    await flush()
    assert.deepEqual(completed, ['width 1', 'width 30', 'width 40'])
    renderer.dispose()
})

test('switching mode cancels waiting drag values and suppresses old results; disposal drops waiting work', async () => {
    const { renderer, calls, completed } = queuedRenderer()
    renderer.renderLatest('/part.scad', { width: 1 }, 'preview')
    renderer.renderLatest('/part.scad', { width: 2 }, 'preview')
    const full = renderer.render('/part.scad', { width: 3 }, 'render')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].format, ModelFormat.STL)
    calls[0].resolve(Buffer.from('obsolete CSG'))
    calls[1].resolve(Buffer.from('full 3'))
    await full
    assert.deepEqual(completed, ['full 3'])
    assert.equal(calls.length, 2)
    renderer.renderLatest('/part.scad', { width: 4 }, 'preview')
    renderer.renderLatest('/part.scad', { width: 5 }, 'preview')
    renderer.dispose()
    calls[2].resolve(Buffer.from('disposed'))
    await flush()
    assert.equal(calls.length, 3)
    assert.deepEqual(completed, ['full 3'])
})

test('an obsolete parameter error does not interrupt the latest queued value', async () => {
    const { renderer, calls, completed, errors } = queuedRenderer()
    renderer.renderLatest('/part.scad', { width: 1 }, 'render')
    renderer.renderLatest('/part.scad', { width: 2 }, 'render')
    calls[0].reject(new Error('bad intermediate value'))
    await flush()
    assert.deepEqual(errors, [])
    calls[1].resolve(Buffer.from('width 2'))
    await flush()
    assert.deepEqual(completed, ['width 2'])
    renderer.dispose()
})

test('fallback is explicit, discards queued drag values and waits for a final commit', async () => {
    const { renderer, calls, backends, completed } = queuedRenderer()
    renderer.renderLatest('/part.scad', { width: 0 }, 'preview')
    calls[0].resolve(Buffer.from('supported'))
    await flush()
    assert.equal(backends.at(-1)?.kind, 'csg')
    renderer.renderLatest('/part.scad', { width: 1 }, 'preview', 'input')
    renderer.renderLatest('/part.scad', { width: 2 }, 'preview', 'input')
    calls[1].resolve(Buffer.from('unsupported'))
    await flush()
    assert.equal(backends.at(-1)?.kind, 'fallback')
    assert.equal(backends.at(-1)?.reason, 'non-triangular polyhedron face')
    assert.equal(calls[2].format, ModelFormat.STL)
    renderer.renderLatest('/part.scad', { width: 3 }, 'preview', 'input')
    calls[2].resolve(Buffer.from('fallback 1'))
    await flush()
    assert.equal(calls.length, 3, 'No intermediate drag job may run after fallback')
    renderer.renderLatest('/part.scad', { width: 2 }, 'preview', 'commit')
    assert.equal(calls.length, 4, 'The last released value still needs a render')
    calls[3].resolve(Buffer.from('unsupported'))
    await flush()
    calls[4].resolve(Buffer.from('fallback 2'))
    await flush()
    assert.equal(backends.at(-1)?.kind, 'fallback')
    assert.ok(backends.at(-1)!.elapsedMs! >= 0)
    assert.deepEqual(completed, ['supported', 'fallback 1', 'fallback 2'])
    renderer.dispose()
})

test('ordinary rendering ignores intermediate requests and deduplicates a final commit already in flight', async () => {
    const { renderer, calls } = queuedRenderer()
    renderer.renderLatest('/part.scad', { width: 1 }, 'render', 'input')
    assert.equal(calls.length, 0)
    renderer.renderLatest('/part.scad', { width: 2 }, 'render', 'commit')
    renderer.renderLatest('/part.scad', { width: 2 }, 'render', 'commit')
    calls[0].resolve(Buffer.from('mesh 2'))
    await flush()
    renderer.renderLatest('/part.scad', { width: 2 }, 'render', 'commit')
    assert.equal(calls.length, 1)
    renderer.dispose()
})
