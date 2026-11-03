import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { ModelFormat } from '../../features/preview/shared/types/ModelFormat'
import type { ScadRenderer } from '../../features/preview/extension/services/ScadRenderer'
function fixture() {
    const calls: { mode: ModelFormat; signal: AbortSignal; resolve: (b: Buffer) => void; reject: (e: Error) => void }[] = [],
        frames: string[] = [],
        errors: Error[] = [],
        backends: any[] = []
    const module = { exports: {} as { ScadRenderer: typeof ScadRenderer } },
        require = createRequire(import.meta.url)
    const source = readFileSync(new URL('../../features/preview/extension/services/ScadRenderer.ts', import.meta.url), 'utf8')
    runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
        module,
        Buffer,
        performance,
        AbortController,
        Error,
        require: (id: string) => {
            if (id === 'vscode') return { workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) } }
            if (id.endsWith('/ModelFormat')) return { ModelFormat }
            if (id.endsWith('/previewEligibility')) return { EmptyModelError: class extends Error {} }
            if (id === './ScadClient') return { ScadClient: { render: (_p: unknown, _params: unknown, mode: ModelFormat, _log: unknown, _key: unknown, _deps: unknown, signal: AbortSignal) => new Promise<Buffer>((resolve, reject) => calls.push({ mode, signal, resolve, reject })) } }
            return require(id)
        },
    })
    const renderer = new module.exports.ScadRenderer({ onComplete: ({ buffer }) => frames.push(buffer.toString()), onError: (e) => errors.push(e), onBackendChange: (b) => backends.push(b) })
    return { renderer, calls, frames, errors, backends }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
test('mode changes cancel old work, publish only latest, and Full Render keeps native mesh', async () => {
    const f = fixture(),
        a = f.renderer.render('/part.scad', {}, 'render'),
        b = f.renderer.render('/part.scad', {}, 'preview')
    assert.equal(f.calls[0].mode, ModelFormat.STL)
    assert.equal(f.calls[1].mode, ModelFormat.PreviewScene)
    assert.equal(f.calls[0].signal.aborted, true)
    f.calls[1].resolve(Buffer.from('prepared'))
    await b
    f.calls[0].resolve(Buffer.from('old'))
    await a
    assert.deepEqual(f.frames, ['prepared'])
    f.renderer.dispose()
})
test('continuous parameters abort obsolete work and coalesce to newest request', async () => {
    const f = fixture()
    const first = f.renderer.render('/part.scad', {}, 'preview')
    f.calls[0].resolve(Buffer.from('initial'))
    await first
    f.renderer.renderLatest('/part.scad', { width: 1 }, 'preview', 'input')
    f.renderer.renderLatest('/part.scad', { width: 2 }, 'preview', 'input')
    f.renderer.renderLatest('/part.scad', { width: 3 }, 'preview', 'commit')
    assert.equal(f.calls[1].signal.aborted, true)
    f.calls[1].resolve(Buffer.from('obsolete'))
    await settle()
    assert.equal(f.calls.length, 3)
    f.calls[2].resolve(Buffer.from('latest'))
    await settle()
    assert.deepEqual(f.frames, ['initial', 'latest'])
    f.renderer.dispose()
})
test('cache reuse avoids exporter work; invalidation and disposal prevent stale publication', async () => {
    const f = fixture(),
        a = f.renderer.render('/part.scad', {}, 'preview')
    f.calls[0].resolve(Buffer.from('prepared'))
    await a
    await f.renderer.render('/part.scad', {}, 'preview', true)
    assert.equal(f.calls.length, 1)
    assert.equal(f.backends.at(-1).cacheHit, true)
    const b = f.renderer.render('/part.scad', {}, 'preview')
    assert.equal(f.calls.length, 2)
    f.renderer.dispose()
    f.calls[1].resolve(Buffer.from('after-dispose'))
    await b
    assert.deepEqual(f.frames, ['prepared', 'prepared'])
})
test('exporter errors are surfaced with no legacy or mesh fallback', async () => {
    const f = fixture(),
        a = f.renderer.render('/part.scad', {}, 'preview')
    f.calls[0].reject(new Error('Preview Exporter unavailable'))
    await a
    assert.equal(f.errors[0].message, 'Preview Exporter unavailable')
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].mode, ModelFormat.PreviewScene)
    f.renderer.dispose()
})

test('continuous input never starves frames and only the newest pending sample runs', async () => {
    const f = fixture(),
        initial = f.renderer.render('/part.scad', {}, 'preview')
    f.calls[0].resolve(Buffer.from('initial'))
    await initial
    f.renderer.renderLatest('/part.scad', { width: 1 }, 'preview', 'input')
    f.renderer.renderLatest('/part.scad', { width: 2 }, 'preview', 'input')
    f.renderer.renderLatest('/part.scad', { width: 3 }, 'preview', 'input')
    assert.equal(f.calls[1].signal.aborted, false)
    f.calls[1].resolve(Buffer.from('drag-1'))
    await settle()
    assert.equal(f.calls.length, 3)
    f.calls[2].resolve(Buffer.from('drag-3'))
    await settle()
    assert.deepEqual(f.frames, ['initial', 'drag-1', 'drag-3'])
    f.renderer.dispose()
})

test('host phase timings survive prepared-scene transport metadata parsing', async () => {
    const f = fixture()
    f.renderer.render('/model.scad', {}, 'preview')
    await new Promise((resolve) => setImmediate(resolve))
    f.calls[0].resolve(Buffer.from(JSON.stringify({ timings: { exporterMs: 12.5, jsonParseMs: 0.125, validationMs: 0.2, conversionMs: 0.3 }, dependencies: [] })))
    await new Promise((resolve) => setImmediate(resolve))
    const timings = f.backends.at(-1).timings
    assert.equal(timings.exporterMs, 12.5)
    assert.equal(timings.jsonParseMs, 0.125)
    assert.ok(Number.isFinite(timings.resultParseMs))
    assert.ok(Number.isFinite(timings.cliMs))
    f.renderer.dispose()
})
