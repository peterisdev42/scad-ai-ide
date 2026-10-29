import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PreviewSync, hash } from './engine.mjs'

const config = { roots: { preview: 'preview', ide: 'ide' }, trees: [['src', 'src']], files: [], exclude: ['src/bootstrap.ts'], watch: { preview: ['package.json'], ide: ['package.json'] } }
// These fixtures deliberately avoid JS syntax so text diff3 cases stay readable.
const formatter = { version: 'test', format: async (text) => text, resolveConfig: async () => ({}) }
async function fixture(t, { upstream = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n', internal = upstream } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-sync-test-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    for (const side of ['preview', 'ide']) {
        await fs.mkdir(path.join(root, side, 'src'), { recursive: true })
        await fs.writeFile(path.join(root, side, 'package.json'), '{}')
        await fs.writeFile(path.join(root, side, 'src/model.txt'), side === 'preview' ? upstream : internal)
        await fs.writeFile(path.join(root, side, 'src/bootstrap.ts'), `${side} bootstrap`)
    }
    const sync = new PreviewSync(root, { config, formatter })
    await sync.initialize()
    return {
        root,
        sync,
        write: (side, text, file = 'src/model.txt') => fs.writeFile(path.join(root, side, file), text),
        read: (side, file = 'src/model.txt') => fs.readFile(path.join(root, side, file), 'utf8'),
        async transfer(direction) {
            const { plan } = await sync.plan(direction)
            assert.ok(plan.entries.every((entry) => !entry.conflicts.length))
            return sync.apply(plan.id)
        },
    }
}

test('initial paired baselines preserve intentional host differences and exclude bootstrap', async (t) => {
    const f = await fixture(t, { internal: 'IDE adapter\n' })
    assert.deepEqual((await f.sync.changes()).rows, [])
    assert.equal(await f.transfer('to-ide'), 0)
    assert.equal(await f.transfer('to-preview'), 0)
    await f.write('preview', 'new bootstrap', 'src/bootstrap.ts')
    assert.deepEqual((await f.sync.changes()).rows, [])
    await assert.rejects(f.sync.initialize(), /已存在/)
})

test('forward then reverse sync transfers only later edits while retaining host adaptations', async (t) => {
    const f = await fixture(t, { internal: 'IDE adapter\ntwo\nthree\nfour\nfive\nsix\nseven\n' })
    await f.write('preview', 'one\ntwo\nthree\nfour\nfive\nsix\nupstream\n')
    assert.equal(await f.transfer('to-ide'), 1)
    assert.equal(await f.read('ide'), 'IDE adapter\ntwo\nthree\nfour\nfive\nsix\nupstream\n')
    await f.write('ide', 'IDE adapter\ntwo\nthree\nnew feature\nfive\nsix\nupstream\n')
    assert.equal(await f.transfer('to-preview'), 1)
    assert.equal(await f.read('preview'), 'one\ntwo\nthree\nnew feature\nfive\nsix\nupstream\n')
    assert.deepEqual((await f.sync.changes()).rows, [])
})

test('unsent destination edits remain pending and can be reverse-synced after importing', async (t) => {
    const f = await fixture(t)
    await f.write('ide', 'local IDE\ntwo\nthree\nfour\nfive\nsix\nseven\n')
    await f.write('preview', 'one\ntwo\nthree\nfour\nfive\nsix\nupstream\n')
    await f.transfer('to-ide')
    const rows = (await f.sync.changes()).rows
    assert.equal(rows[0].ideChanged, true)
    assert.equal(rows[0].previewChanged, false)
    await f.transfer('to-preview')
    assert.equal(await f.read('preview'), 'local IDE\ntwo\nthree\nfour\nfive\nsix\nupstream\n')
    assert.deepEqual((await f.sync.changes()).rows, [])
})

test('dry-run preserves working files; stale plans cannot apply over later edits', async (t) => {
    const f = await fixture(t)
    const before = await f.read('ide')
    await f.write('preview', 'new source\n')
    const { plan } = await f.sync.plan('to-ide')
    assert.equal(await f.read('ide'), before)
    await f.write('ide', 'later target edit\n')
    await assert.rejects(f.sync.apply(plan.id), /文件有变化/)
    assert.equal(await f.read('ide'), 'later target edit\n')
})

test('conflict rejects the entire plan, then accepts an explicitly resolved artifact', async (t) => {
    const f = await fixture(t, { internal: 'adapter\n' })
    await f.write('preview', 'upstream replacement\n')
    await f.write('preview', 'new file\n', 'src/added.txt')
    const { plan, folder } = await f.sync.plan('to-ide')
    const index = plan.entries.findIndex((entry) => entry.pair.preview === 'src/model.txt')
    assert.ok(plan.entries[index].conflicts.length)
    await assert.rejects(f.sync.apply(plan.id), /尚未解决冲突/)
    await assert.rejects(f.read('ide', 'src/added.txt'), { code: 'ENOENT' })
    await fs.writeFile(path.join(folder, `${index}.merged`), 'resolved adapter + feature\n')
    plan.entries[index].resolved = true
    await fs.writeFile(path.join(folder, 'plan.json'), JSON.stringify(plan))
    assert.equal(await f.sync.apply(plan.id), 2)
    assert.equal(await f.read('ide'), 'resolved adapter + feature\n')
    assert.deepEqual((await f.sync.changes()).rows, [])
})

test('unresolved markers are rejected even after resolved=true; skipped conflicts stay pending', async (t) => {
    const f = await fixture(t, { internal: 'adapter\n' })
    await f.write('preview', 'new source\n')
    const { plan, folder } = await f.sync.plan('to-ide')
    plan.entries[0].resolved = true
    await fs.writeFile(path.join(folder, 'plan.json'), JSON.stringify(plan))
    await assert.rejects(f.sync.apply(plan.id), /冲突标记/)
    plan.entries[0].skip = true
    await fs.writeFile(path.join(folder, 'plan.json'), JSON.stringify(plan))
    assert.equal(await f.sync.apply(plan.id), 0)
    assert.equal((await f.sync.changes()).rows[0].previewChanged, true)
})

test('adds and deletes synchronize in both directions; binary divergence requires a choice', async (t) => {
    const f = await fixture(t)
    const binary = Buffer.from([0, 1, 2, 3])
    await f.write('preview', binary, 'src/model.stl')
    await f.transfer('to-ide')
    assert.equal(hash(await fs.readFile(path.join(f.root, 'ide/src/model.stl'))), hash(binary))
    await fs.unlink(path.join(f.root, 'ide/src/model.stl'))
    await f.transfer('to-preview')
    await assert.rejects(fs.access(path.join(f.root, 'preview/src/model.stl')), { code: 'ENOENT' })
    await f.write('preview', Buffer.from([0, 2]), 'src/model.stl')
    await f.write('ide', Buffer.from([0, 3]), 'src/model.stl')
    const { plan } = await f.sync.plan('to-ide')
    assert.ok(plan.entries[0].conflicts.length)
})

test('edit/delete does not silently remove an adapter', async (t) => {
    const f = await fixture(t, { internal: 'adapter\n' })
    await fs.unlink(path.join(f.root, 'preview/src/model.txt'))
    const { plan } = await f.sync.plan('to-ide')
    assert.ok(plan.entries[0].conflicts.length)
    await assert.rejects(f.sync.apply(plan.id), /尚未解决冲突/)
    assert.equal(await f.read('ide'), 'adapter\n')
})

test('unmapped host metadata changes are reported, never copied', async (t) => {
    const f = await fixture(t)
    await f.write('preview', '{"dependencies":{"new":"1"}}', 'package.json')
    assert.deepEqual((await f.sync.changes()).watched, ['preview: package.json'])
    await f.transfer('to-ide')
    assert.equal(await f.read('ide', 'package.json'), '{}')
})

test('symlinks and traversal cannot write outside the mapped roots', async (t) => {
    const f = await fixture(t)
    await fs.symlink('/tmp', path.join(f.root, 'ide/src/linked'))
    await assert.rejects(f.sync.changes(), /符号链接/)
    await assert.rejects(f.sync.read('ide', '../outside'), /非法同步路径/)
})

test('a failed write rolls back earlier files and keeps the old baseline', async (t) => {
    const f = await fixture(t)
    const before = await f.read('ide')
    await f.write('preview', 'source feature\n')
    await f.write('preview', 'new\n', 'src/added.txt')
    const { plan } = await f.sync.plan('to-ide')
    const original = f.sync.atomic.bind(f.sync)
    let count = 0
    f.sync.atomic = async (file, bytes) => {
        if (++count === 2) {
            throw new Error('disk fixture failure')
        }
        return original(file, bytes)
    }
    await assert.rejects(f.sync.apply(plan.id), /disk fixture failure/)
    assert.equal(await f.read('ide'), before)
    await assert.rejects(f.read('ide', 'src/added.txt'), { code: 'ENOENT' })
    assert.equal((await f.sync.changes()).rows.length, 2)
})

test('only one synchronization may hold the lock', async (t) => {
    const f = await fixture(t)
    await f.sync.locked(() => assert.rejects(f.sync.plan('to-ide'), /同步锁/))
})

test('format-only differences and mapped test imports normalize and serialize reversibly', async (t) => {
    const f = await fixture(t)
    const realFormatter = createRequire(new URL('../../package.json', import.meta.url))('prettier')
    const testConfig = { ...config, files: [['src/test/view.test.ts', 'src/test/view.test.ts']] }
    const sync = new PreviewSync(f.root, { config: testConfig, formatter: realFormatter })
    const pair = { preview: 'src/test/view.test.ts', ide: 'src/test/view.test.ts' }
    const preview = await sync.normalize(Buffer.from('import { A } from "../webview/A";\nconst x=1;\n'), pair, 'preview')
    const ide = await sync.normalize(Buffer.from("import { A } from '../../features/preview/webview/A'\nconst x = 1\n"), pair, 'ide')
    assert.equal(hash(preview), hash(ide))
    const serialized = await sync.serialize(ide, pair, 'preview')
    assert.match(serialized.toString(), /\.\.\/webview\/A/)
    assert.doesNotMatch(serialized.toString(), /features\/preview/)
})

test('missing checkout refuses synchronization instead of deleting all mapped files', async (t) => {
    const f = await fixture(t)
    const original = await f.read('ide')
    await fs.rm(path.join(f.root, 'preview'), { recursive: true })
    await assert.rejects(f.sync.plan('to-ide'), /仓库未就绪/)
    assert.equal(await f.read('ide'), original)
})

test('host acknowledgement clears warnings without hiding pending source changes', async (t) => {
    const f = await fixture(t)
    await f.write('preview', 'feature\n')
    await f.write('preview', '{"new":true}', 'package.json')
    assert.equal(await f.sync.acknowledgeHost(), 1)
    const changes = await f.sync.changes()
    assert.deepEqual(changes.watched, [])
    assert.equal(changes.rows.length, 1)
})

test('resolving a working conflict retains the independent destination delta for reverse sync', async (t) => {
    const f = await fixture(t)
    await f.write('preview', 'upstream\n')
    await f.write('ide', 'IDE pending\n')
    const { plan, folder } = await f.sync.plan('to-ide')
    assert.equal(plan.entries[0].same, false)
    assert.deepEqual(plan.entries[0].conflicts, ['working'])
    await fs.writeFile(path.join(folder, '0.merged'), 'upstream plus IDE pending\n')
    plan.entries[0].resolved = true
    await fs.writeFile(path.join(folder, 'plan.json'), JSON.stringify(plan))
    await f.sync.apply(plan.id)
    assert.equal((await f.sync.changes()).rows[0].ideChanged, true)
    await f.transfer('to-preview')
    assert.equal(await f.read('preview'), 'upstream plus IDE pending\n')
    assert.deepEqual((await f.sync.changes()).rows, [])
})

test('a baseline change invalidates an already reviewed plan', async (t) => {
    const f = await fixture(t)
    await f.write('preview', 'new source\n')
    const { plan } = await f.sync.plan('to-ide')
    await f.write('preview', '{"updated":true}', 'package.json')
    await f.sync.acknowledgeHost()
    await assert.rejects(f.sync.apply(plan.id), /基线已变化/)
})

test('current repository snapshot round-trips a real viewport change without copying adapters', async (t) => {
    const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const { config: actualConfig } = await import('./config.mjs')
    const previewRoot = path.resolve(project, process.env.PREVIEW_SYNC_PREVIEW_ROOT || actualConfig.roots.preview)
    try {
        await fs.access(path.join(previewRoot, 'package.json'))
    } catch {
        t.skip('Set PREVIEW_SYNC_PREVIEW_ROOT to run the external repository integration test')
        return
    }
    const fixtureConfig = { ...actualConfig, roots: { preview: 'preview', ide: 'ide' } }
    const realFormatter = createRequire(path.join(project, 'package.json'))('prettier')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-sync-snapshot-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const copy = async (relative, source) => {
        const target = path.join(root, relative)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.cp(source, target, { recursive: true }).catch((error) => {
            if (error.code !== 'ENOENT') {
                throw error
            }
        })
    }
    for (const side of ['preview', 'ide']) {
        const base = fixtureConfig.roots[side]
        const sourceRoot = side === 'ide' ? project : previewRoot
        for (const [preview, ide] of actualConfig.trees) {
            await copy(`${base}/${side === 'preview' ? preview : ide}`, path.join(sourceRoot, side === 'preview' ? preview : ide))
        }
        for (const [preview, ide] of actualConfig.files) {
            await copy(`${base}/${side === 'preview' ? preview : ide}`, path.join(sourceRoot, side === 'preview' ? preview : ide))
        }
        for (const file of actualConfig.watch[side]) {
            await copy(`${base}/${file}`, path.join(sourceRoot, file))
        }
    }
    await copy('ide/.prettierrc.json', path.join(project, '.prettierrc.json'))
    await copy('preview/prettier.config.ts', path.join(previewRoot, 'prettier.config.ts'))
    const sync = new PreviewSync(root, { config: fixtureConfig, formatter: realFormatter })
    await sync.initialize()
    assert.deepEqual((await sync.changes()).rows, [])
    const external = path.join(root, fixtureConfig.roots.preview, 'src/webview/preview/rigs/DirectionalLightRig.ts')
    const internal = path.join(root, fixtureConfig.roots.ide, 'src/features/preview/webview/preview/rigs/DirectionalLightRig.ts')
    const adapter = path.join(root, fixtureConfig.roots.ide, 'src/features/preview/extension/services/ScadClient.ts')
    const originalAdapter = hash(await fs.readFile(adapter))
    await fs.appendFile(external, '\nexport const previewSyncFixture = 1;\n')
    const incoming = await sync.plan('to-ide')
    assert.equal(incoming.plan.entries.length, 1)
    assert.deepEqual(incoming.plan.entries[0].conflicts, [])
    await sync.apply(incoming.plan.id)
    assert.match(await fs.readFile(internal, 'utf8'), /previewSyncFixture = 1/)
    await fs.writeFile(internal, (await fs.readFile(internal, 'utf8')).replace('previewSyncFixture = 1', 'previewSyncFixture = 2'))
    const outgoing = await sync.plan('to-preview')
    assert.deepEqual(outgoing.plan.entries[0].conflicts, [])
    await sync.apply(outgoing.plan.id)
    assert.match(await fs.readFile(external, 'utf8'), /previewSyncFixture = 2/)
    assert.equal(hash(await fs.readFile(adapter)), originalAdapter)
    assert.deepEqual((await sync.changes()).rows, [])
})


test('standalone IDE owns baselines and accepts a relocated external checkout', async (t) => {
    const f = await fixture(t)
    const ideRoot = path.join(f.root, 'ide')
    const external = path.join(f.root, 'external-preview')
    await fs.rename(path.join(f.root, 'preview'), external)
    await fs.rename(path.join(f.root, '.preview-sync'), path.join(ideRoot, '.preview-sync'))
    const localConfig = { ...config, roots: { ide: '.', preview: '../missing-default' } }
    const sync = new PreviewSync(ideRoot, { config: localConfig, formatter, previewRoot: external })
    assert.deepEqual((await sync.changes()).rows, [])
    await fs.writeFile(path.join(external, 'src/model.txt'), 'standalone change\n')
    const { plan } = await sync.plan('to-ide')
    await sync.apply(plan.id)
    assert.equal(await f.read('ide'), 'standalone change\n')
    await assert.rejects(sync.safe('preview', '../escape'), /非法同步路径/)
    const linked = path.join(f.root, 'linked-preview')
    await fs.symlink(external, linked)
    const unsafe = new PreviewSync(ideRoot, { config: localConfig, formatter, previewRoot: linked })
    await assert.rejects(unsafe.changes(), /符号链接/)
})
