import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { latestCached } from '../../core/libraries/latestCached'
import type { InstalledLibrary } from '../../core/libraries/types'
import { registry, repo, commitA, commitB } from './helpers'
const entity = (commit: string, versions: string[], installedAt = '2026-11-01'): InstalledLibrary => ({ libraryId: 'fixture', repositoryUrl: repo, commit, versions, installedAt, sourcePath: '', sizeBytes: 0, integrity: 'verified', files: {} })
test('Latest cached selection prefers the cached Registry recommendation, then numeric tags and stable releases', () => {
    const a = entity(commitA, ['v10.0.0-beta.2'])
    const b = entity(commitB, ['v2'])
    assert.equal(latestCached([a, b], registry().libraries[0]), b)
    const uncached = { ...registry().libraries[0], latestVersion: 'v20' }
    assert.equal(latestCached([a, b], uncached), a)
    const stable = entity('c'.repeat(40), ['v10.0.0'])
    assert.equal(latestCached([a, b, stable]), stable)
    assert.equal(latestCached([a, stable], { ...registry().libraries[0], repositoryUrl: 'https://github.com/other/fixture' }), stable)
})
test('Latest cached snapshots use cached catalog ordering and fall back to installation time without a catalog', () => {
    const a = entity(commitA, [`snapshot:${commitA}`], '2026-11-01')
    const b = entity(commitB, [`snapshot:${commitB}`], '2026-11-02')
    const catalog = { ...registry().libraries[0], latestVersion: null }
    assert.equal(latestCached([a, b], catalog), a)
    assert.equal(latestCached([a, b]), b)
})
