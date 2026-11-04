import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as path from 'node:path'
import { rm } from 'node:fs/promises'
import { fixture, repo, commitA } from './helpers'
import { LibraryGarbageCollector } from '../../platform/libraries/LibraryGarbageCollector'
test('Cleanup refuses known references, requires explicit confirmation and rechecks after confirmation', async () => {
    const f = await fixture()
    const entity = { libraryId: 'fixture', repositoryUrl: repo, commit: commitA }
    try {
        await f.manager.install(f.project, 'fixture', 'v1')
        const gc = new LibraryGarbageCollector(f.store, f.manager.references)
        let confirmations = 0
        await assert.rejects(
            gc.remove(entity, async () => {
                confirmations++
                return true
            }),
            /Cannot delete/,
        )
        assert.equal(confirmations, 0)
        await f.manager.remove(f.project, 'fixture')
        assert.equal(await gc.remove(entity, async () => false), false)
        assert.equal(await f.store.verify('fixture', repo, commitA), true)
        await assert.rejects(
            gc.remove(entity, async (preview) => {
                assert.equal(preview.externalReferencesUnknown, true)
                await f.manager.install(f.project, 'fixture', 'v1')
                return true
            }),
            /Cannot delete/,
        )
        await f.manager.remove(f.project, 'fixture')
        assert.equal(await gc.remove(entity, async () => true), true)
        assert.equal(await f.store.find('fixture', repo, commitA), undefined)
    } finally {
        await f.cleanup()
    }
})
test('Unreadable known projects block cleanup; forged deletion IDs are rejected', async () => {
    const f = await fixture()
    try {
        await f.manager.install(f.project, 'fixture', 'v1')
        await f.manager.remove(f.project, 'fixture')
        await rm(f.project, { recursive: true })
        const gc = new LibraryGarbageCollector(f.store, f.manager.references)
        await assert.rejects(
            gc.remove({ libraryId: 'fixture', repositoryUrl: repo, commit: commitA }, async () => true),
            /unreadable/,
        )
        await assert.rejects(gc.preview({ libraryId: '../outside', repositoryUrl: repo, commit: commitA }))
    } finally {
        await f.cleanup()
    }
})

test('A known project without any dependencies does not masquerade as an unreadable reference', async () => {
    const f = await fixture()
    try {
        await f.installer.ensureInstalled('fixture', (await import('./helpers.js')).locked())
        await f.manager.references.register(f.project)
        const preview = await new LibraryGarbageCollector(f.store, f.manager.references).preview({ libraryId: 'fixture', repositoryUrl: repo, commit: commitA })
        assert.deepEqual(preview.projects, [])
        assert.deepEqual(preview.unavailable, [])
    } finally {
        await f.cleanup()
    }
})

test('Bulk cleanup keeps one latest cached commit per library/repository and skips referenced versions', async () => {
    const f = await fixture()
    try {
        const { locked, commitB, registry } = await import('./helpers.js')
        await f.manager.install(f.project, 'fixture', 'v1')
        await f.installer.ensureInstalled('fixture', locked(commitB))
        const older = { ...locked('c'.repeat(40)), resolved: { kind: 'tag' as const, tag: 'v0', commit: 'c'.repeat(40) } }
        await f.installer.ensureInstalled('fixture', older)
        const otherRepo = 'https://github.com/other/fixture'
        for (const commit of [commitA, commitB]) {
            const dependency = locked(commit)
            dependency.source.repositoryUrl = otherRepo
            await f.installer.ensureInstalled('fixture', dependency)
        }
        const gc = new LibraryGarbageCollector(f.store, f.manager.references)
        const plan = await gc.previewAll(true, registry().libraries)
        assert.equal(plan.retained, 2, 'Each repository keeps its own latest version')
        assert.equal(plan.protectedCount, 1)
        assert.equal(plan.candidates.length, 2)
        const result = await gc.removeAll(true, registry().libraries, async (preview) => {
            assert.equal(preview.candidates.length, 2)
            return true
        })
        assert.deepEqual(result, { removed: 2, retained: 2, protectedCount: 1 })
        assert.ok(await f.store.find('fixture', repo, commitA))
        assert.ok(await f.store.find('fixture', repo, commitB))
        assert.ok(await f.store.find('fixture', otherRepo, commitB))
        assert.equal((await f.store.list()).length, 3)
    } finally {
        await f.cleanup()
    }
})

test('Bulk cleanup rechecks project references after confirmation and never deletes newly added versions', async () => {
    const f = await fixture()
    try {
        const { locked, commitB } = await import('./helpers.js')
        await f.installer.ensureInstalled('fixture', locked(commitA))
        await f.installer.ensureInstalled('fixture', locked(commitB))
        const gc = new LibraryGarbageCollector(f.store, f.manager.references)
        await gc.removeAll(false, [], async () => false)
        assert.equal((await f.store.list()).length, 2, 'Cancel leaves every version intact')
        const result = await gc.removeAll(false, [], async (plan) => {
            assert.equal(plan.candidates.length, 2)
            await f.manager.install(f.project, 'fixture', 'v1')
            await f.installer.ensureInstalled('fixture', { ...locked(), resolved: { kind: 'tag', tag: 'v3', commit: 'c'.repeat(40) } })
            return true
        })
        assert.equal(result.removed, 1)
        assert.equal(result.protectedCount, 1)
        assert.ok(await f.store.find('fixture', repo, commitA))
        assert.ok(await f.store.find('fixture', repo, 'c'.repeat(40)))
        await rm(f.project, { recursive: true })
        const blocked = await gc.removeAll(false, [], async () => { throw new Error('No confirmation for fully protected content') })
        assert.equal(blocked.removed, 0)
        assert.equal(blocked.protectedCount, 2)
    } finally {
        await f.cleanup()
    }
})
