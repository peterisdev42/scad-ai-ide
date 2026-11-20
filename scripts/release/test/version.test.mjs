import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { parseVersion, validatePlan, digest } from '../common/schema.mjs'
import { attempt, git } from '../common/io.mjs'
import { marketHistory } from '../version/providers.mjs'
import { reserveTag, remoteReservation, remoteFrozenPlans } from '../version/git.mjs'
import { inventory, resolveVersion } from '../version/resolve.mjs'
import { fixturePlan, histories } from './fixtures.mjs'

const withHistory = entries => inventory(entries, { complete: true, versions: [] })
const resolve = (versions, options = {}) => resolveVersion(withHistory(histories(versions)),
    { name: 'scad-ai-ide', channel: 'preview', change: 'fix', cycle: 'continue', ...options })

test('versions use the selected release cycle and channel', () => {
    assert.equal(resolve(['0.3.7']).version, '0.3.8')
    assert.equal(resolve(['0.2.3', '0.3.7'], { channel: 'stable', cycle: 'hotfix', base: '0.2.3' }).version, '0.2.4')
    assert.equal(resolve(['0.3.7'], { channel: 'stable', cycle: 'promote', approved: true }).version, '0.4.0')
    assert.equal(resolve(['0.4.5'], { cycle: 'next', approved: true }).version, '0.5.0')
    assert.throws(() => resolve(['0.4.5'], { cycle: 'next' }), /approval/)
    assert.throws(() => resolve(['0.4.5'], { change: 'breaking', cycle: 'continue' }), /Major/)
    assert.equal(resolve(['0.4.5'], { change: 'breaking', cycle: 'major', major: '1', approved: true }).version, '1.1.0')
    assert.equal(resolve([], { cycle: 'initial' }).version, '0.1.0')
})

test('canonical plan and strict inputs', () => {
    for (const version of ['1.2.3-beta.1', '01.2.3', '1.2', '1.2.3+build', '9007199254740992.0.0']) {
        assert.throws(() => parseVersion(version))
    }
    const plan = fixturePlan()
    for (const edit of [{ channel: 'stable' }, { version: '0.4.0' }, { tag: 'v1.0.0' }, { targetCommand: 'shell' },
        { offlineMock: true }, { targets: ['darwin-x64', 'darwin-arm64'] }, { targets: ['../bin'] }]) {
        assert.throws(() => validatePlan({ ...plan, ...edit }))
    }
    assert.equal(digest(plan), digest(Object.fromEntries(Object.entries(plan).reverse())))
})

test('partial, conflicting and unknown histories are not treated as free versions', () => {
    const state = histories(['0.3.7', '0.3.8'])
    state[1].versions = state[1].versions.filter(item => item.version !== '0.3.8')
    const choose = () => resolveVersion(withHistory(state), { channel: 'preview', change: 'fix', cycle: 'continue', name: 'scad-ai-ide' })
    assert.equal(choose().releases[0].releaseId, 'scad-ai-ide-v0.3.8')
    assert.equal(choose().releases[0].status, 'partial')
    state[0].versions.at(-1).preRelease = false
    assert.equal(choose().releases[0].status, 'conflict')
    state[0].versions.at(-1).preRelease = true
    state[1].complete = false
    assert.equal(choose().status, 'candidate-unverified')
})

test('market absence, permission, retry and malformed responses are distinguished', async () => {
    const extension = fixturePlan().extension
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status })
    assert.equal((await marketHistory('openvsx', extension, { fetcher: async () => response({}, 404) })).presence, 'absent')
    assert.equal((await marketHistory('vscode', extension, { fetcher: async () =>
        response({ results: [{ extensions: [] }] }) })).presence, 'absent')
    for (const status of [401, 403, 404, 429, 503]) {
        let calls = 0
        const result = await marketHistory('vscode', extension, { fetcher: async () => {
            calls++
            return response({}, status)
        } })
        assert.equal(result.complete, false)
        assert.equal(result.presence, 'unknown')
        assert.equal(calls, status === 429 || status >= 500 ? 3 : 1)
    }
    assert.equal((await marketHistory('openvsx', extension, { fetcher: async () => { throw new Error('network') } })).presence, 'unknown')
    assert.equal((await marketHistory('vscode', extension, { fetcher: async () => response([]) })).presence, 'unknown')
})

test('Open VSX enumerates every page and its exact target/channel', async () => {
    const { extension, version } = fixturePlan()
    let broken = false
    const fetcher = async url => {
        const path = new URL(url)
        const identity = { namespace: extension.publisher, name: extension.name }
        if (path.pathname.endsWith('/version-references')) {
            const offset = Number(path.searchParams.get('offset'))
            return Response.json({ offset, totalSize: 2, versions: offset && broken ? [] : [{
                version, targetPlatform: offset ? 'linux-x64' : 'darwin-arm64',
            }] })
        }
        if (path.pathname.endsWith(version)) {
            return Response.json({ ...identity, version, targetPlatform: path.pathname.split('/').at(-2), preRelease: true })
        }
        return Response.json({ ...identity, allVersions: { [version]: 'unused' } })
    }
    assert.deepEqual((await marketHistory('openvsx', extension, { fetcher })).versions.map(item => item.target), ['darwin-arm64', 'linux-x64'])
    broken = true
    assert.equal((await marketHistory('openvsx', extension, { fetcher })).complete, false)
})

test('atomic annotated tag reservation has one concurrent winner and an idempotent retry', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'scad-release-reservation-test-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    git(dir, ['init', '--quiet', 'source'])
    git(dir, ['init', '--bare', '--quiet', 'remote'])
    const source = join(dir, 'source'), remote = join(dir, 'remote')
    git(source, ['config', 'user.name', 'Release Test'])
    git(source, ['config', 'user.email', 'test@example.invalid'])
    git(source, ['commit', '--allow-empty', '-m', 'one'])
    const first = git(source, ['rev-parse', 'HEAD'])
    git(source, ['commit', '--allow-empty', '-m', 'two'])
    const second = git(source, ['rev-parse', 'HEAD'])
    const candidates = [fixturePlan({ sourceCommit: first }), fixturePlan({ sourceCommit: second })]
    const moduleUrl = new URL('../version/git.mjs', import.meta.url).href
    const results = await Promise.all(candidates.map(plan => attempt(process.execPath, ['--input-type=module', '-e',
        `import { reserveTag } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(reserveTag(...${JSON.stringify([source, remote, plan])})))`,
    ])))
    assert.equal(results.filter(result => result.pass).length, 1)
    const winner = candidates[results.findIndex(result => result.pass)]
    assert.equal(remoteReservation(remote, winner).planSha256, digest(winner))
    assert.deepEqual(remoteFrozenPlans(remote, winner.repository, winner.extension, [winner.version]), {
        [winner.version]: winner,
    })
    assert.equal(reserveTag(source, remote, winner).created, false)
    assert.throws(() => reserveTag(source, remote, candidates.find(candidate => candidate !== winner)), /different release plan/)
    assert.equal(git(remote, ['rev-list', '-n', '1', winner.tag]), winner.sourceCommit)
})
