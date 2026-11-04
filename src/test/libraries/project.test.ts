import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rename, rm, symlink, lstat } from 'node:fs/promises'
import * as path from 'node:path'
import { fixture, commitA, commitB, repo } from './helpers'
import { LibraryLinker } from '../../platform/libraries/LibraryLinker'
import { ProjectDependencyManager } from '../../platform/libraries/ProjectDependencyManager'
import { atomicJson } from '../../platform/libraries/files'
test('Two projects isolate versions; lockfile-only restore works offline and removal preserves global content', async () => {
    const f = await fixture()
    try {
        const other = path.join(f.root, 'Project B')
        await mkdir(other)
        await f.manager.install(f.project, 'fixture', 'v1')
        await f.manager.install(other, 'fixture', 'v2')
        assert.equal((await f.manager.list(f.project))[0].status, 'Ready')
        const file = path.join(f.project, '.scad', 'lib', 'fixture-library', 'smoke.scad')
        assert.match(await readFile(file, 'utf8'), /cube\(10\)/)
        assert.match(await readFile(path.join(other, '.scad/lib/fixture-library/smoke.scad'), 'utf8'), /cube\(20\)/)
        const lock = await readFile(path.join(f.project, '.scad/dependencies.lock.json'), 'utf8')
        assert.equal(lock.includes(f.root), false)
        f.offline()
        await rm(path.join(f.project, '.scad/lib'), { recursive: true })
        await f.manager.restore(f.project)
        assert.equal(f.downloads(), 2)
        await f.manager.remove(f.project, 'fixture')
        assert.deepEqual(await f.manager.list(f.project), [])
        assert.equal((await f.store.list()).length, 2)
        const refs = await f.manager.references.references({ libraryId: 'fixture', repositoryUrl: repo, commit: commitB })
        assert.deepEqual(refs.projects, [other])
        assert.equal(refs.externalReferencesUnknown, true)
        assert.match(await readFile(path.join(f.project, '.gitignore'), 'utf8'), /\.scad\/lib\//)
    } finally {
        await f.cleanup()
    }
})
test('Mount failures roll back project version and never overwrite unmanaged directories', async () => {
    const f = await fixture()
    try {
        await f.manager.install(f.project, 'fixture', 'v1')
        const failing = new LibraryLinker()
        failing.create = async () => {
            throw new Error('injected link failure')
        }
        const manager = new ProjectDependencyManager(f.store, f.client, f.installer, failing)
        await assert.rejects(manager.install(f.project, 'fixture', 'v2'), /injected/)
        assert.equal((await f.manager.read(f.project)).lock.dependencies.fixture.resolved.commit, commitA)
        assert.equal((await f.manager.list(f.project))[0].status, 'Ready')
        const unmanaged = path.join(f.project, '.scad/lib/precious')
        await mkdir(unmanaged)
        await writeFile(path.join(unmanaged, 'data'), 'preserve')
        await assert.rejects(f.manager.remove(f.project, 'fixture'), /unmanaged/)
        assert.equal(await readFile(path.join(unmanaged, 'data'), 'utf8'), 'preserve')
    } finally {
        await f.cleanup()
    }
})
test('Interrupted publication restores old links and files before another operation', async () => {
    const f = await fixture()
    try {
        await f.manager.install(f.project, 'fixture', 'v1')
        const scad = path.join(f.project, '.scad')
        const tx = path.join(scad, '.dependency-transaction')
        await mkdir(tx)
        const existed = ['dependencies.json', 'dependencies.lock.json', 'mounts.json']
        for (const name of existed) await writeFile(path.join(tx, name), await readFile(path.join(scad, name)))
        await atomicJson(path.join(tx, 'journal.json'), { version: 1, existed, hadLib: true })
        await rename(path.join(scad, 'lib'), path.join(tx, 'previous'))
        await mkdir(path.join(scad, 'lib'))
        await writeFile(path.join(scad, 'dependencies.json'), '{"manifestVersion":1,"dependencies":{}}')
        await f.manager.restore(f.project)
        assert.equal((await f.manager.list(f.project))[0].status, 'Ready')
        assert.equal((await f.manager.read(f.project)).lock.dependencies.fixture.resolved.commit, commitA)
    } finally {
        await f.cleanup()
    }
})
test('Copy fallback requires confirmation, detects edited copies and can be declined', async () => {
    const deniedLink = async () => {
        throw Object.assign(new Error('permission'), { code: 'EPERM' })
    }
    let confirmations = 0
    const linker = new LibraryLinker(
        async () => {
            confirmations++
            return true
        },
        'win32',
        deniedLink,
    )
    const f = await fixture(linker)
    try {
        await f.manager.install(f.project, 'fixture', 'v1')
        assert.equal(confirmations, 1)
        assert.equal((await lstat(path.join(f.project, '.scad/lib/fixture-library'))).isSymbolicLink(), false)
        assert.equal((await f.manager.list(f.project))[0].mode, 'copy')
        await writeFile(path.join(f.project, '.scad/lib/fixture-library/local.scad'), 'preserve')
        await assert.rejects(f.manager.remove(f.project, 'fixture'), /local modifications/)
        const declined = new LibraryLinker(async () => false, 'win32', deniedLink)
        await assert.rejects(declined.create(path.join(f.root, 'global'), path.join(f.root, 'declined')), /declined/)
    } finally {
        await f.cleanup()
    }
})
test('Project symlink roots and foreign mount links are not followed during mutation', async () => {
    const f = await fixture()
    try {
        await f.manager.install(f.project, 'fixture', 'v1')
        const mount = path.join(f.project, '.scad/lib/fixture-library')
        await rm(mount)
        await symlink(f.root, mount, process.platform === 'win32' ? 'junction' : 'dir')
        await assert.rejects(f.manager.remove(f.project, 'fixture'), /changed outside/)
        assert.ok(await readFile(path.join(f.project, '.scad/dependencies.lock.json')))
    } finally {
        await f.cleanup()
    }
})
