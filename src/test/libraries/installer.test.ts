import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { writeFile, readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { extractLibraryArchive } from '../../platform/libraries/archive'
import { LibraryInstaller } from '../../platform/libraries/LibraryInstaller'
import { fixture, locked, commitA, commitB, repo } from './helpers'
test('Immutable store deduplicates concurrent installs, separates commits/repositories and detects corruption', async () => {
    const f = await fixture()
    try {
        const [a, b] = await Promise.all([f.installer.ensureInstalled('fixture', locked()), f.installer.ensureInstalled('fixture', locked())])
        assert.equal(a.sourcePath, b.sourcePath)
        assert.equal(f.downloads(), 1)
        await f.installer.ensureInstalled('fixture', locked(commitB))
        assert.equal((await f.store.list()).length, 2)
        assert.notEqual(f.store.directory('fixture', repo, commitA), f.store.directory('fixture', 'https://github.com/other/fixture', commitA))
        await writeFile(path.join(a.sourcePath, 'smoke.scad'), 'damaged')
        assert.equal(await f.store.verify('fixture', repo, commitA), false)
        await f.installer.ensureInstalled('fixture', locked())
        assert.equal(f.downloads(), 3)
        assert.equal(await f.store.verify('fixture', repo, commitA), true)
        assert.ok((await readdir(path.join(f.store.root, 'staging'))).some((n) => n.startsWith('corrupted-')))
    } finally {
        await f.cleanup()
    }
})
test('Failed/cancelled downloads and unsafe redirects never publish an entity', async () => {
    const f = await fixture()
    try {
        const installer = new LibraryInstaller(f.store, async () => new Response('bad ZIP'))
        await assert.rejects(installer.ensureInstalled('fixture', locked()))
        assert.equal((await f.store.list()).length, 0)
        assert.deepEqual(await readdir(path.join(f.store.root, 'staging')), [])
        const redirected = new LibraryInstaller(f.store, async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/library.zip' } }))
        await assert.rejects(redirected.ensureInstalled('fixture', locked()), /Unsafe/)
        const abort = new AbortController()
        abort.abort()
        await assert.rejects(f.installer.ensureInstalled('fixture', locked(), abort.signal))
        assert.equal(f.downloads(), 0)
    } finally {
        await f.cleanup()
    }
})
test('ZIP rejects traversal, Windows names, Unicode/case collisions and symlinks', async () => {
    const f = await fixture()
    try {
        const bad = [zipSync({ '../escape.scad': strToU8('x') }), zipSync({ 'root/CON.scad': strToU8('x') }), zipSync({ 'root/A.scad': strToU8('x'), 'root/a.scad': strToU8('y') }), zipSync({ 'root/é.scad': strToU8('x'), 'root/é.scad': strToU8('y') }), zipSync({ 'root/link': [strToU8('/outside'), { os: 3, attrs: 0o120777 << 16 }] })]
        for (let i = 0; i < bad.length; i++) {
            const file = path.join(f.root, `bad-${i}.zip`)
            await writeFile(file, bad[i])
            await assert.rejects(extractLibraryArchive(file, path.join(f.root, `extract-${i}`)), `unsafe archive ${i}`)
        }
        await assert.rejects(readFile(path.join(f.root, 'escape.scad')))
    } finally {
        await f.cleanup()
    }
})

test('ZIP checksum corruption is rejected; orphaned metadata is visible rather than reused', async () => {
    const f = await fixture()
    try {
        const raw = Buffer.from(zipSync({ 'root/file.scad': strToU8('cube(1);') }, { level: 0 }))
        raw[30 + raw.readUInt16LE(26) + raw.readUInt16LE(28)] ^= 1
        const file = path.join(f.root, 'crc.zip')
        await writeFile(file, raw)
        await assert.rejects(extractLibraryArchive(file, path.join(f.root, 'crc-extracted')), /CRC/)
        const installed = await f.installer.ensureInstalled('fixture', locked())
        await writeFile(path.join(path.dirname(installed.sourcePath), 'metadata.json'), 'broken metadata')
        assert.equal((await f.store.list()).length, 0)
        assert.match(f.store.issues[0].message, /Unreadable or orphaned/)
        await f.installer.ensureInstalled('fixture', locked())
        assert.equal(await f.store.verify('fixture', repo, commitA), true)
    } finally {
        await f.cleanup()
    }
})
