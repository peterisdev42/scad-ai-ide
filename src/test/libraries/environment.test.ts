import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { LibraryEnvironment, buildLibraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { fixture } from './helpers'
test('Environment isolates workspaces, preserves base env and fingerprints version/link changes', async () => {
    const f = await fixture()
    try {
        const other = path.join(f.root, 'Other')
        await mkdir(other)
        await f.manager.install(f.project, 'fixture', 'v1')
        await f.manager.install(other, 'fixture', 'v2')
        const env = new LibraryEnvironment()
        env.configure(() => [f.project, other])
        const source = path.join(f.project, 'nested/main.scad')
        const base = { OPENSCADPATH: '/existing', TEST: 'preserve' }
        const actual = await env.getEnvironment(source, base)
        assert.equal(actual.OPENSCADPATH, path.join(f.project, '.scad', 'lib') + path.delimiter + '/existing')
        assert.equal(actual.TEST, 'preserve')
        assert.equal(base.OPENSCADPATH, '/existing')
        assert.equal(await env.resolveProjectRoot(path.join(other, 'main.scad')), other)
        const before = await env.getDependencyFingerprint(source)
        await f.manager.install(f.project, 'fixture', 'v2')
        assert.notEqual(await env.getDependencyFingerprint(source), before)
        assert.equal((await env.getSearchPaths(path.join(other, 'main.scad'))).length, 1)
        await rm(path.join(f.project, '.scad/lib'), { recursive: true })
        assert.equal((await env.getSearchPaths(source)).length, 0)
    } finally {
        await f.cleanup()
    }
})

test('Real OpenSCAD resolves a linked library, changes geometry after version switch and retains Store on removal', async (t) => {
    const executable = process.env.SCAD_OPENSCAD_EXECUTABLE ?? 'openscad'
    try {
        await promisify(execFile)(executable, ['--version'], { timeout: 10000 })
    } catch (error) {
        if (process.env.SCAD_REQUIRE_CLI === '1') throw error
        t.skip('OpenSCAD CLI is not available. Set SCAD_OPENSCAD_EXECUTABLE.')
        return
    }
    const f = await fixture()
    try {
        const { writeFile, readFile, stat } = await import('node:fs/promises')
        const source = path.join(f.project, 'main.scad')
        const output = path.join(f.root, 'model.stl')
        await writeFile(source, 'include <fixture-library/smoke.scad>; test_shape();')
        const env = new LibraryEnvironment()
        env.configure(() => [f.project])
        await f.manager.install(f.project, 'fixture', 'v1')
        const render = async () => {
            await promisify(execFile)(executable, ['--export-format', 'asciistl', '-o', output, source], { env: await env.getEnvironment(source), timeout: 30000 })
            assert.ok((await stat(output)).size > 0)
            return readFile(output, 'utf8')
        }
        const first = await render()
        await f.manager.install(f.project, 'fixture', 'v2')
        const second = await render()
        assert.notEqual(first, second)
        await f.manager.remove(f.project, 'fixture')
        assert.equal((await f.store.list()).length, 2)
    } finally {
        await f.cleanup()
    }
})

test('Windows uses semicolons and retains inherited case-insensitive OPENSCADPATH; POSIX uses colons', () => {
    const base = { OpenSCADPath: 'C:\\old', KEEP: 'yes' }
    const win = buildLibraryEnvironment(['C:\\project\\.scad\\lib'], base, 'win32')
    assert.equal(win.OpenSCADPath, 'C:\\project\\.scad\\lib;C:\\old')
    assert.equal(Object.keys(win).filter((key) => key.toUpperCase() === 'OPENSCADPATH').length, 1)
    assert.deepEqual(base, { OpenSCADPath: 'C:\\old', KEEP: 'yes' })
    assert.equal(buildLibraryEnvironment(['/project/.scad/lib'], { OPENSCADPATH: '/old' }, 'linux').OPENSCADPATH, '/project/.scad/lib:/old')
    assert.throws(() => buildLibraryEnvironment(['/project:ambiguous/lib'], {}, 'darwin'))
})

test('Real Fast Preview and Markdown use the same project library environment', { skip: !process.env.SCAD_PREVIEW_EXPORTER, timeout: 60000 }, async () => {
    const f = await fixture()
    try {
        const { runExporter } = await import('../../platform/previewExporter/runtime.js')
        const { renderScadModel } = await import('../../features/markdown/ScadModelRenderer.js')
        const source = 'include <fixture-library/smoke.scad>; test_shape();'
        await f.manager.install(f.project, 'fixture', 'v1')
        const scene = JSON.parse((await runExporter(process.env.SCAD_PREVIEW_EXPORTER!, source, f.project)).toString())
        assert.equal(scene.bounds.max[0] - scene.bounds.min[0], 10)
        assert.ok(scene.dependencies.some((d: { path: string }) => d.path.endsWith('smoke.scad')))
        const markdown = JSON.parse(await renderScadModel({ executable: process.env.SCAD_OPENSCAD_EXECUTABLE!, argsPrefix: [] }, source, f.project, new AbortController().signal))
        assert.ok(markdown.content.length > 0)
        assert.ok(markdown.dependencies.some((d: { path: string }) => d.path.endsWith('smoke.scad')))
    } finally {
        await f.cleanup()
    }
})
