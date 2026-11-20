import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { readJson, sha256 } from '../common/io.mjs'
import { markets } from '../common/target-matrix.mjs'
import { publishRelease } from '../publish/publish.mjs'
import { artifactSet, fixturePlan } from './fixtures.mjs'

function setup(t, plan = fixturePlan()) {
    const directory = mkdtempSync(join(tmpdir(), 'scad-release-publisher-test-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    return { plan, directory, ...artifactSet(directory, plan) }
}

function mockProviders({ plan, manifest }) {
    const stores = Object.fromEntries(markets.map(market => [market, new Map()]))
    const counts = { upload: 0, auth: 0, query: 0, reservation: 0 }
    const behavior = {}
    const providers = Object.fromEntries(markets.map(market => [market, {
        authenticate: async publisher => {
            counts.auth++
            assert.equal(publisher, plan.extension.publisher)
            await behavior.auth?.(market)
        },
        query: async () => {
            counts.query++
            if (await behavior.query?.(market)) return { complete: false }
            return { complete: true, versions: [...stores[market].keys()].map(target => ({
                target, version: plan.version, preRelease: plan.preRelease,
            })) }
        },
        download: async (_extension, _version, target) => stores[market].get(target),
        upload: async file => {
            counts.upload++
            const artifact = manifest.artifacts.find(item => item.file === basename(file))
            const bytes = readFileSync(file)
            assert.equal(sha256(bytes), artifact.sha256)
            if (!await behavior.drop?.(market, artifact.target)) stores[market].set(artifact.target, bytes)
            if (await behavior.throw?.(market, artifact.target)) throw new Error('simulated response lost')
        },
    }]))
    const dependencies = { providers, pause: async () => {}, verifyReservation: async () => {
        counts.reservation++
        return true
    } }
    return { counts, stores, behavior, dependencies }
}

const confirmation = plan => ({ apply: true, confirmRelease: plan.releaseId })

test('dry-run verifies immutable handoff without reading credentials or querying markets', async t => {
    const input = setup(t)
    const mocks = mockProviders(input)
    const result = await publishRelease(input.plan, input.manifest, input.path, {}, mocks.dependencies)
    assert.equal(result.dryRun, true)
    assert.equal(result.actions.length, 8)
    assert.deepEqual(mocks.counts, { upload: 0, auth: 0, query: 0, reservation: 0 })
    assert.equal(existsSync(join(input.directory, 'publish-state.json')), false)
})

test('apply blocks missing confirmation, credentials, reservation, runtime evidence and unhashed bytes', async t => {
    const input = setup(t)
    const { plan, manifest, path, directory } = input
    const { counts, behavior, dependencies } = mockProviders(input)
    await assert.rejects(publishRelease(plan, manifest, path, { apply: true }, dependencies), /confirm-release/)
    await assert.rejects(publishRelease({ ...plan, status: 'draft-unreserved' }, manifest, path, confirmation(plan), dependencies), /frozen/)
    const incomplete = structuredClone(manifest)
    incomplete.artifacts[0].validation['vsix-install'] = 'not-run'
    await assert.rejects(publishRelease(plan, incomplete, path, confirmation(plan), dependencies), /runtime evidence/)
    await assert.rejects(publishRelease(plan, manifest, path, confirmation(plan), {
        ...dependencies, verifyReservation: async () => null,
    }), /reservation/)
    behavior.auth = () => { throw new Error('missing credential') }
    await assert.rejects(publishRelease(plan, manifest, path, confirmation(plan), dependencies), /missing credential/)
    const different = structuredClone(manifest)
    different.planSha256 = 'b'.repeat(64)
    await assert.rejects(publishRelease(plan, different, path, {}, dependencies), /Plan hash mismatch/)
    const artifact = join(directory, manifest.artifacts[0].file)
    const bytes = readFileSync(artifact)
    bytes[8] ^= 1
    writeFileSync(artifact, bytes)
    await assert.rejects(publishRelease(plan, manifest, path, {}, dependencies), /hash/)
    rmSync(artifact)
    const outside = join(directory, 'alternate.vsix')
    writeFileSync(outside, bytes)
    symlinkSync(outside, artifact)
    await assert.rejects(publishRelease(plan, manifest, path, {}, dependencies))
    assert.equal(counts.upload, 0)
})

test('four targets by two markets recover after partial failure and lost upload response', async t => {
    const input = setup(t)
    const { plan, manifest, path } = input
    const { counts, behavior, stores, dependencies } = mockProviders(input)
    behavior.drop = (market, target) => market === 'openvsx' && target === 'win32-x64'
    behavior.throw = (market, target) => market === 'vscode' && target === 'darwin-arm64' || behavior.drop(market, target)
    const first = await publishRelease(plan, manifest, path, confirmation(plan), dependencies)
    assert.equal(first.code, 6)
    assert.equal(first.state.overall, 'partial')
    assert.equal(first.state.targets.vscode['darwin-arm64'].status, 'verified')
    assert.equal(first.state.targets.openvsx['win32-x64'].status, 'unknown')
    assert.equal(first.state.targets.openvsx['win32-x64'].lastErrorCode, 'upload-outcome-unknown')
    assert.equal(counts.upload, 8)

    const interrupted = readJson(first.statePath)
    interrupted.targets.vscode['darwin-arm64'].status = 'uploading'
    writeFileSync(first.statePath, JSON.stringify(interrupted))
    behavior.drop = null
    behavior.throw = null
    const second = await publishRelease(plan, manifest, path, confirmation(plan), dependencies)
    assert.equal(second.state.overall, 'complete')
    assert.equal(second.code, 0)
    assert.equal(counts.upload, 9)
    assert.equal(second.state.targets.vscode['darwin-arm64'].attempts, 1)
    assert.equal(second.state.targets.openvsx['win32-x64'].attempts, 2)
    assert.equal(stores.openvsx.size, 4)
    assert.equal(stores.vscode.size, 4)
})

test('read failures, conflicting bytes and unverifiable existing versions block uploads', async t => {
    const input = setup(t)
    const { plan, manifest, path } = input
    const { counts, behavior, stores, dependencies } = mockProviders(input)
    behavior.query = market => market === 'openvsx'
    const blocked = await publishRelease(plan, manifest, path, confirmation(plan), dependencies)
    assert.equal(blocked.code, 3)
    assert.equal(blocked.state.targets.openvsx['linux-x64'].status, 'unknown')
    behavior.query = null
    stores.vscode.set('darwin-arm64', Buffer.from('different bytes'))
    stores.openvsx.set('darwin-arm64', null)
    const reconcile = await publishRelease(plan, manifest, path, { query: true }, dependencies)
    assert.equal(reconcile.remote.vscode['darwin-arm64'].status, 'conflict')
    assert.equal(reconcile.remote.openvsx['darwin-arm64'].status, 'present-unverifiable')
    const mismatch = await publishRelease(plan, manifest, path, confirmation(plan), dependencies)
    assert.equal(mismatch.code, 4)
    assert.equal(counts.upload, 0)
})

test('a formerly verified version disappearing never permits automatic re-upload', async t => {
    const input = setup(t, fixturePlan({ target: ['darwin-arm64'] }))
    const { plan, manifest, path } = input
    const { counts, behavior, stores, dependencies } = mockProviders(input)
    assert.equal((await publishRelease(plan, manifest, path, confirmation(plan), dependencies)).code, 0)
    stores.vscode.delete('darwin-arm64')
    behavior.query = market => market === 'vscode'
    assert.equal((await publishRelease(plan, manifest, path, confirmation(plan), dependencies)).code, 3)
    behavior.query = null
    const readOnly = await publishRelease(plan, manifest, path, { query: true }, dependencies)
    assert.equal(readOnly.remote.vscode['darwin-arm64'].reason, 'remote-version-disappeared')
    const result = await publishRelease(plan, manifest, path, confirmation(plan), dependencies)
    assert.equal(result.code, 4)
    assert.equal(result.state.targets.vscode['darwin-arm64'].status, 'blocked')
    assert.equal(counts.upload, 2)
})

test('eight uploads reconcile through a mock HTTP server after a response disconnect', async t => {
    const { plan, manifest, path } = setup(t)
    const stores = Object.fromEntries(markets.map(market => [market, new Map()]))
    let uploads = 0
    const server = createServer(async (request, response) => {
        const [, market, target] = request.url.split('/')
        const store = stores[market]
        if (request.method === 'POST') {
            const chunks = []
            for await (const chunk of request) chunks.push(chunk)
            store.set(target, Buffer.concat(chunks))
            if (++uploads === 1) response.destroy()
            else response.writeHead(201).end()
        } else if (target) {
            if (store.has(target)) response.end(store.get(target))
            else response.writeHead(404).end()
        } else {
            response.end(JSON.stringify({ complete: true, versions: [...store.keys()].map(target => ({
                target, version: plan.version, preRelease: plan.preRelease,
            })) }))
        }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => server.close())
    const providers = Object.fromEntries(markets.map(market => {
        const url = `http://127.0.0.1:${server.address().port}/${market}`
        return [market, {
            authenticate: async () => {},
            query: async () => (await fetch(url)).json(),
            download: async (_extension, _version, target) => {
                const response = await fetch(`${url}/${target}`)
                return response.ok ? Buffer.from(await response.arrayBuffer()) : null
            },
            upload: async path => {
                const { target } = manifest.artifacts.find(item => item.file === basename(path))
                const response = await fetch(`${url}/${target}`, { method: 'POST', body: readFileSync(path) })
                assert.equal(response.status, 201)
            },
        }]
    }))
    const dependencies = { providers, verifyReservation: async () => true }
    assert.equal((await publishRelease(plan, manifest, path, confirmation(plan), dependencies)).state.overall, 'complete')
    assert.equal((await publishRelease(plan, manifest, path, confirmation(plan), dependencies)).state.overall, 'complete')
    assert.equal(uploads, 8)
})
