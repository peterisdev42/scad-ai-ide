import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore } from '../../platform/cad/ArtifactStore'
import { createHash } from 'node:crypto'
test('artifacts are content-bound, leased, evicted and never accept filesystem paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cad-artifact-test-'))
    const store = new ArtifactStore(dir, 8, 2, 60000)
    try {
        const a = await store.put('a', 'mesh', 'model/stl', Buffer.from('12345678'))
        assert.equal(a.sha256, createHash('sha256').update('12345678').digest('hex'))
        const release = store.lease([a.id])
        await assert.rejects(store.put('b', 'mesh', 'model/stl', Buffer.from('x')), /leased/)
        assert.equal((await store.read(a.id)).toString(), '12345678')
        release()
        const b = await store.put('b', 'mesh', 'model/stl', Buffer.from('x'))
        await assert.rejects(store.read(a.id), /expired|evicted/)
        assert.equal((await store.read(b.id)).toString(), 'x')
        await assert.rejects(store.read('../secret'), /expired|evicted/)
        assert.equal((await store.put('b', 'mesh', 'model/stl', Buffer.from('x'))).id, b.id)
    } finally {
        await store.dispose()
        await rm(dir, { recursive: true, force: true })
    }
})

test('artifact leases protect TTL expiry while corruption is always rejected', async () => {
    const { writeFile } = await import('node:fs/promises')
    const dir = await mkdtemp(join(tmpdir(), 'cad-artifact-ttl-')),
        store = new ArtifactStore(dir, 32, 2, 5)
    try {
        const ref = await store.put('snapshot', 'mesh', 'model/stl', Buffer.from('bytes')),
            release = store.lease([ref.id])
        await new Promise((resolve) => setTimeout(resolve, 15))
        assert.equal((await store.read(ref.id)).toString(), 'bytes')
        await writeFile(join(dir, ref.id), 'other')
        await assert.rejects(store.read(ref.id), /changed|unavailable/)
        release()
        const expired = await store.put('snapshot', 'mesh', 'model/stl', Buffer.from('fresh'))
        await new Promise((resolve) => setTimeout(resolve, 15))
        await assert.rejects(store.read(expired.id), /expired|evicted/)
    } finally {
        await store.dispose()
    }
})
