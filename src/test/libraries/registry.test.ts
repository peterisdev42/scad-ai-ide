import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { parseRegistry, parseLockfile, parseManifest, installLayout, safePart } from '../../core/libraries/validation'
import { RegistryClient } from '../../platform/libraries/RegistryClient'
import { fixture, registry, library, locked, commitA, commitB, repo } from './helpers'
test('Registry v1/v2 validates exact repository-pinned versions and preserves null latest', () => {
    for (const schemaVersion of [1, 2]) {
        const r = registry()
        r.schemaVersion = schemaVersion as 1 | 2
        r.libraries[0].latestVersion = null
        assert.equal(parseRegistry(r).libraries[0].latestVersion, null)
    }
    for (const downloadUrl of [`${repo}/archive/main.zip`, `${repo}/archive/${commitB}.zip`, `http://github.com/example/fixture/archive/${commitA}.zip`]) {
        const r = registry()
        r.libraries[0].versions[0].downloadUrl = downloadUrl
        assert.throws(() => parseRegistry(r))
    }
    const mismatched = registry()
    mismatched.libraries[0].versions[0].downloadUrl = `https://github.com/evil/repo/archive/${commitA}.zip`
    assert.match(parseRegistry(mismatched).libraries[0].validationError!, /differs/)
    const r = registry()
    r.libraries.push(library())
    assert.throws(() => parseRegistry(r), /Duplicate/)
})
test('Snapshot and sync errors remain explicit; unreviewed layouts never guessed', () => {
    const r = registry()
    const l = r.libraries[0]
    l.latestVersion = null
    l.versions = [{ kind: 'snapshot', tag: null, prerelease: true, commit: commitA, downloadUrl: `${repo}/archive/${commitA}.zip` }]
    assert.equal(parseRegistry(r).libraries[0].versions[0].kind, 'snapshot')
    l.versions = []
    l.sync.status = 'error'
    assert.equal(parseRegistry(r).libraries[0].versions.length, 0)
    delete l.layout
    assert.throws(() => installLayout(l), /not been audited/)
    assert.deepEqual(installLayout({ id: 'bosl2', repositoryUrl: 'https://github.com/BelfrySCAD/BOSL2' }), { includeName: 'BOSL2', includeRoot: '.' })
    assert.throws(() => installLayout({ id: 'bosl2', repositoryUrl: repo }), /not been audited/)
})
test('Manifests and locks reject unsafe paths, ranges and cross-platform collisions', () => {
    assert.throws(() => parseManifest({ manifestVersion: 1, dependencies: { fixture: { version: '^1.0' } } }), /exact/)
    for (const name of ['../outside', 'C:\\evil', 'CON', 'a:', 'trailing.', '__proto__']) assert.throws(() => safePart(name))
    const dep = locked()
    dep.resolved.commit = 'aaaa'
    assert.throws(() => parseLockfile({ lockVersion: 1, dependencies: { fixture: dep } }))
    const a = locked(),
        b = locked()
    b.mount.name = a.mount.name.toUpperCase()
    assert.throws(() => parseLockfile({ lockVersion: 1, dependencies: { fixture: a, other: b } }), /collide/)
})
test('Registry supports ETag/304, validated disk cache and offline cold restart', async () => {
    const f = await fixture()
    try {
        await f.client.getRegistry()
        f.offline()
        const client = new RegistryClient(f.store.root, f.request)
        assert.equal((await client.getRegistry()).libraries.length, 1)
        assert.equal(client.offline, true)
        let etag: string | undefined
        const revalidated = new RegistryClient(f.store.root, async (_url, options) => {
            etag = (options?.headers as Record<string, string>)['If-None-Match']
            return new Response(null, { status: 304 })
        })
        await revalidated.getRegistry()
        assert.equal(etag, 'fixture-etag')
        assert.equal(revalidated.offline, false)
        assert.equal((await client.search('FIXTURE LIBRARY')).length, 1)
        assert.equal((await client.search('missing')).length, 0)
    } finally {
        await f.cleanup()
    }
})

test('Registry globalState list is immediately available while refresh is pending, shared by callers and preserved on failure', async () => {
    const { registryCacheKey, REGISTRY_URL } = await import('../../platform/libraries/RegistryClient.js')
    const f = await fixture()
    try {
        const entries = new Map<string, unknown>()
        const storage = {
            get: (key: string) => entries.get(key),
            update: async (key: string, value: unknown) => {
                entries.set(key, value)
            },
        }
        entries.set(registryCacheKey(), { version: 1, sourceUrl: REGISTRY_URL, registry: registry(), etag: 'cached-etag' })
        let respond!: (value: Response) => void
        let started!: () => void
        let requests = 0
        const requested = new Promise<void>((resolve) => {
            started = resolve
        })
        const request: typeof fetch = async (_url, options) => {
            requests++
            assert.equal((options?.headers as Record<string, string>)['If-None-Match'], 'cached-etag')
            started()
            return new Promise((resolve) => {
                respond = resolve
            })
        }
        const client = new RegistryClient(f.store.root, request, undefined, storage)
        assert.equal((await client.restoreCachedRegistry())?.libraries[0].description, 'A test fixture')
        assert.equal(requests, 0, 'Restoring the list must never wait for or start the network')
        const loading = client.getRegistry(true)
        const concurrent = client.getRegistry(true)
        await requested
        assert.equal(requests, 1)
        assert.equal((await client.search('test fixture')).length, 1, 'Search remains local while the request is pending')
        const updated = registry()
        updated.libraries[0].description = 'New remote description'
        respond(new Response(JSON.stringify(updated), { headers: { etag: 'updated-etag' } }))
        await Promise.all([loading, concurrent])
        assert.equal((await client.search('remote')).length, 1)
        const snapshot = JSON.stringify([...entries])
        const offline = new RegistryClient(
            f.store.root,
            async () => {
                throw new Error('offline')
            },
            undefined,
            storage,
        )
        assert.equal((await offline.restoreCachedRegistry())?.libraries[0].description, 'New remote description')
        await offline.getRegistry(true)
        assert.equal(offline.offline, true)
        assert.equal(JSON.stringify([...entries]), snapshot)
        const empty = new RegistryClient(f.store.root, async () => new Response(JSON.stringify({ ...registry(), libraries: [] })), undefined, storage)
        await empty.getRegistry(true)
        assert.deepEqual((await empty.getRegistry()).libraries, [])
        const restarted = new RegistryClient(
            f.store.root,
            async () => {
                throw new Error('must remain local')
            },
            undefined,
            storage,
        )
        assert.deepEqual((await restarted.restoreCachedRegistry())?.libraries, [], 'A valid empty catalog replaces older results')
    } finally {
        await f.cleanup()
    }
})

test('Registry imports its old disk list, prefers valid globalState and ignores corrupt or foreign cache data', async () => {
    const { registryCacheKey, readRegistryCache, REGISTRY_URL } = await import('../../platform/libraries/RegistryClient.js')
    const { atomicJson } = await import('../../platform/libraries/files.js')
    const path = await import('node:path')
    const f = await fixture()
    try {
        const entries = new Map<string, unknown>()
        const storage = {
            get: (key: string) => entries.get(key),
            update: async (key: string, value: unknown) => {
                entries.set(key, value)
            },
        }
        await atomicJson(path.join(f.store.root, 'cache', 'registry.json'), { registry: registry(), etag: 'legacy' })
        const migrate = new RegistryClient(
            f.store.root,
            async () => {
                throw new Error('offline')
            },
            undefined,
            storage,
        )
        await migrate.restoreCachedRegistry()
        assert.equal(readRegistryCache(entries.get(registryCacheKey()))?.etag, 'legacy')
        const saved = registry()
        saved.libraries[0].description = 'Prefer globalState'
        entries.set(registryCacheKey(), { version: 1, sourceUrl: REGISTRY_URL, registry: saved })
        const primary = new RegistryClient(f.store.root, f.request, undefined, storage)
        assert.equal((await primary.restoreCachedRegistry())?.libraries[0].description, 'Prefer globalState')
        for (const raw of [null, {}, { version: 2, sourceUrl: REGISTRY_URL, registry: saved }, { version: 1, sourceUrl: 'https://other.example/registry.json', registry: saved }, { version: 1, sourceUrl: REGISTRY_URL, registry: { schemaVersion: 99 } }]) assert.equal(readRegistryCache(raw), undefined)
        assert.notEqual(registryCacheKey(), registryCacheKey('https://other.example/registry.json'))
        const other = new RegistryClient(
            f.store.root,
            async () => {
                throw new Error('offline')
            },
            'https://other.example/registry.json',
            storage,
        )
        assert.equal(await other.restoreCachedRegistry(), undefined, 'A different source cannot import the built-in registry file')
        await atomicJson(path.join(f.store.root, 'cache', 'registry.json'), { invalid: true })
        entries.set(registryCacheKey(), { invalid: true })
        const recover = new RegistryClient(f.store.root, f.request, undefined, storage)
        assert.equal(await recover.restoreCachedRegistry(), undefined)
        await recover.getRegistry()
        assert.equal(readRegistryCache(entries.get(registryCacheKey()))?.registry.libraries.length, 1)
    } finally {
        await f.cleanup()
    }
})

test('A bad Registry response cannot overwrite cached results; failed persistence does not discard a fresh list', async () => {
    const { REGISTRY_URL } = await import('../../platform/libraries/RegistryClient.js')
    const f = await fixture()
    try {
        const cached = { version: 1, sourceUrl: REGISTRY_URL, registry: registry() }
        let writes = 0
        const storage = {
            get: () => cached,
            update: async () => {
                writes++
            },
        }
        const client = new RegistryClient(f.store.root, async () => new Response(JSON.stringify({ schemaVersion: 99 })), undefined, storage)
        await client.getRegistry(true)
        assert.equal((await client.search('fixture')).length, 1)
        assert.equal(writes, 0)
        assert.equal(client.offline, true)
        const noDisk = new RegistryClient(f.store.root, f.request, undefined, {
            get: () => undefined,
            update: async () => {
                throw new Error('disk full')
            },
        })
        assert.equal((await noDisk.getRegistry()).libraries.length, 1)
        assert.equal(noDisk.offline, false)
        assert.match(noDisk.status, /Could not save/)
    } finally {
        await f.cleanup()
    }
})
