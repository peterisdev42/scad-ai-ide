import { existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'
import { readVsix, verifyArtifactSet } from '../build/verify.mjs'
import { readJson, requireRelease, sha256, writeJson } from '../common/io.mjs'
import { digest, validate } from '../common/schema.mjs'
import { markets } from '../common/target-matrix.mjs'
import { validateMarketHistory } from '../version/providers.mjs'

const report = (status, metadata = false, bytes = false) => ({
    status, remoteMetadataVerified: metadata, bytesVerified: bytes,
})

async function queryMarket(provider, plan) {
    try {
        const history = await provider.query(plan.extension)
        return history.complete ? validateMarketHistory(history.versions).filter(item => item.version === plan.version) : null
    } catch {
        return null
    }
}

async function compareMarket(provider, plan, artifact, versions) {
    if (!versions) return report('unknown')
    if (versions.some(item => !plan.targets.includes(item.target) || item.preRelease !== plan.preRelease)) {
        return report('conflict')
    }
    if (!versions.some(item => item.target === artifact.target)) return report('missing')
    try {
        const bytes = await provider.download(plan.extension, plan.version, artifact.target, artifact.sizeBytes + 1024 * 1024)
        if (bytes) return sha256(bytes) === artifact.sha256 ?
            report('present-matching', true, true) : report('conflict', true)
    } catch {
        // The listing can be valid while the original package is unavailable.
    }
    return report('present-unverifiable', true)
}

async function reconcile(plan, manifest, providers) {
    const output = {}
    for (const market of markets) {
        const provider = providers[market]
        const versions = await queryMarket(provider, plan)
        const entries = await Promise.all(manifest.artifacts.map(async item =>
            [item.target, await compareMarket(provider, plan, item, versions)]))
        output[market] = Object.fromEntries(entries)
    }
    return output
}

const checkedCell = (cell, remote, version) => {
    const uploadedOnce = cell.uploadedOnce || remote.status === 'present-matching'
    if (remote.status === 'missing' && (uploadedOnce || cell.attempts > 0)) {
        return { ...cell, status: 'blocked', remoteVersion: null,
            lastErrorCode: uploadedOnce ? 'remote-version-disappeared' : 'upload-outcome-unconfirmed',
            remoteMetadataVerified: false, bytesVerified: false }
    }
    const status = ({
        'present-matching': 'verified', 'present-unverifiable': 'blocked',
        conflict: 'blocked', unknown: 'unknown', missing: 'pending',
    })[remote.status]
    return { ...cell, status, uploadedOnce, remoteVersion: remote.remoteMetadataVerified ? version : null,
        lastErrorCode: ['verified', 'pending'].includes(status) ? null : remote.status,
        remoteMetadataVerified: remote.remoteMetadataVerified, bytesVerified: remote.bytesVerified }
}

function newState(plan, manifest) {
    const unset = () => ({ status: 'pending', attempts: 0, remoteVersion: null, lastErrorCode: null,
        remoteMetadataVerified: false, bytesVerified: false, uploadedOnce: false })
    return { schemaVersion: 1, releaseId: plan.releaseId, planSha256: digest(plan), artifactsSha256: digest(manifest),
        overall: 'pending', targets: Object.fromEntries(markets.map(market =>
            [market, Object.fromEntries(plan.targets.map(target => [target, unset()]))])) }
}

function checkExistingState(state, expected, plan) {
    validate('state', state)
    requireRelease(state.releaseId === expected.releaseId && state.planSha256 === expected.planSha256 &&
        state.artifactsSha256 === expected.artifactsSha256 && markets.every(market =>
            Object.keys(state.targets[market]).sort().join() === [...plan.targets].sort().join()),
    'Publish state belongs to different release inputs', 4)
}

function overall(state) {
    const cells = Object.values(state.targets).flatMap(Object.values)
    const successful = cells.filter(item => item.status === 'verified').length
    if (successful === cells.length) return 'complete'
    if (successful) return 'partial'
    if (cells.some(item => ['blocked', 'failed', 'unknown'].includes(item.status))) return 'blocked'
    return 'pending'
}

function verifyRuntime(manifest, paths = []) {
    const expected = digest(manifest)
    const evidence = paths.map(path => validate('smoke', readJson(path)))
    requireRelease(evidence.every(item => item.artifactsSha256 === expected), 'Smoke evidence refers to a different Manifest', 4)
    for (const artifact of manifest.artifacts) {
        const attestations = [artifact.validation, ...evidence.flatMap(item => item.targets).filter(item =>
            item.target === artifact.target && item.sha256 === artifact.sha256)]
        requireRelease(attestations.some(record => ['compile', 'binary-header', 'cli-smoke', 'lsp-stdio', 'vsix-install']
            .every(check => record?.[check] === 'pass')), `Missing successful target runtime evidence: ${artifact.target}`, 2)
    }
}

function selectedCells(plan, options) {
    const requestedMarkets = options.market && options.market !== 'all' ? [options.market] : markets
    requireRelease(requestedMarkets.every(market => markets.includes(market)), 'Invalid market')
    const requestedTargets = options.target ?? plan.targets
    requireRelease(requestedTargets.every(target => plan.targets.includes(target)), 'Target not in Plan')
    return requestedMarkets.flatMap(market => requestedTargets.map(target => ({ market, target })))
}

export async function publishRelease(plan, manifest, manifestPath, options, dependencies) {
    const selected = selectedCells(plan, options)
    const { providers, verifyReservation, pause = delay } = dependencies
    if (options.apply) {
        requireRelease(!plan.status && !plan.offlineMock && options.confirmRelease === plan.releaseId,
            'Apply requires a frozen plan and --confirm-release')
    }
    await verifyArtifactSet(plan, manifest, manifestPath)
    const directory = dirname(resolve(manifestPath))
    const statePath = join(directory, 'publish-state.json')
    if (!options.apply) {
        const remote = options.query ? await reconcile(plan, manifest, providers) : undefined
        const manualReviewRequired = []
        if (remote) {
            const expected = newState(plan, manifest)
            const hasState = existsSync(statePath)
            requireRelease(!hasState || lstatSync(statePath).isFile(), 'Unsafe publish-state path', 4)
            const previous = hasState ? readJson(statePath) : expected
            checkExistingState(previous, expected, plan)
            for (const market of markets) {
                for (const { target, sha256: artifactSha256 } of manifest.artifacts) {
                    const observation = remote[market][target]
                    const cell = previous.targets[market][target]
                    const checked = checkedCell(cell, observation, plan.version)
                    if (observation.status === 'missing' && checked.status === 'blocked') {
                        remote[market][target] = { ...report('blocked'), reason: checked.lastErrorCode }
                    }
                    if (checked.status === 'blocked' || (checked.status === 'unknown' && (cell.attempts > 0 || cell.uploadedOnce))) {
                        manualReviewRequired.push({
                            releaseId: plan.releaseId, market, target, artifactSha256, attempts: cell.attempts,
                            lastStatus: cell.status, reason: checked.lastErrorCode,
                            guidance: 'Check market publishing history and API, original upload logs, and the original VSIX SHA-256. Run reconcile again when the original package is visible.',
                        })
                    }
                }
            }
        }
        const actions = selected.map(item => ({ ...item, file: manifest.artifacts.find(asset => asset.target === item.target).file,
            status: remote?.[item.market][item.target].status ?? 'local-verified' }))
        const statuses = remote ? Object.values(remote).flatMap(Object.values).map(item => item.status) : []
        const code = statuses.includes('unknown') ? 3 :
            statuses.some(status => ['blocked', 'conflict', 'present-unverifiable'].includes(status)) ? 4 : 0
        return { dryRun: true, releaseId: plan.releaseId, planSha256: digest(plan), artifactsSha256: digest(manifest),
            ...(plan.status && { planStatus: plan.status }), actions, ...(remote && { remote, manualReviewRequired }), code }
    }

    verifyRuntime(manifest, options.smoke)
    requireRelease(await verifyReservation(plan), 'No matching remote Git reservation', 4)
    for (const market of new Set(selected.map(item => item.market))) {
        await providers[market].authenticate(plan.extension.publisher)
    }
    // The manifest already exists, so the atomic lock has a stable path before state exists.
    let unlock
    try {
        unlock = await lockfile.lock(resolve(manifestPath), { stale: 120_000, lockfilePath: statePath + '.lock' })
    } catch {
        requireRelease(false, 'Publish state is locked by another process', 4)
    }
    let snapshotRoot
    try {
        const expected = newState(plan, manifest)
        requireRelease(!existsSync(statePath) || lstatSync(statePath).isFile(), 'Unsafe publish-state path', 4)
        const state = existsSync(statePath) ? readJson(statePath) : expected
        checkExistingState(state, expected, plan)
        const save = () => {
            state.overall = overall(state)
            writeJson(statePath, state)
        }
        const remote = await reconcile(plan, manifest, providers)
        for (const market of markets) {
            for (const target of plan.targets) {
                state.targets[market][target] = checkedCell(state.targets[market][target], remote[market][target], plan.version)
            }
        }
        save()
        const statuses = Object.values(state.targets).flatMap(Object.values).map(cell => cell.status)
        if (statuses.includes('unknown') || statuses.includes('blocked')) {
            return { state, statePath, code: statuses.includes('unknown') ? 3 : 4 }
        }
        snapshotRoot = mkdtempSync(join(directory, '.publish-bytes-'))
        for (const { market, target } of selected) {
            if (state.targets[market][target].status === 'verified') continue
            const artifact = manifest.artifacts.find(item => item.target === target)
            const provider = providers[market]
            const cells = state.targets[market]
            const current = await compareMarket(provider, plan, artifact, await queryMarket(provider, plan))
            cells[target] = checkedCell(cells[target], current, plan.version)
            save()
            if (current.status === 'present-matching') continue
            if (cells[target].status !== 'pending' || cells[target].attempts !== 0) {
                return { state, statePath, code: current.status === 'unknown' ? 3 : 4 }
            }
            const bytes = readVsix(join(directory, artifact.file))
            requireRelease(bytes.length === artifact.sizeBytes && sha256(bytes) === artifact.sha256, 'Artifact changed before upload', 4)
            const staged = join(snapshotRoot, artifact.file)
            writeFileSync(staged, bytes, { mode: 0o400 })
            cells[target] = { ...cells[target], status: 'uploading', attempts: cells[target].attempts + 1 }
            save()
            let acknowledged = false
            try {
                await provider.upload(staged)
                acknowledged = true
            } catch {
                // A failed response might follow a successful remote write.
            } finally {
                rmSync(staged, { force: true })
            }
            if (acknowledged) {
                cells[target].status = 'uploaded'
                cells[target].uploadedOnce = true
                save()
            }
            let result
            for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt) await pause(250 * 2 ** attempt)
                result = await compareMarket(provider, plan, artifact, await queryMarket(provider, plan))
                if (['present-matching', 'conflict'].includes(result.status)) break
            }
            cells[target] = checkedCell(cells[target], result, plan.version)
            if (result.status === 'missing') {
                cells[target].status = 'unknown'
                cells[target].lastErrorCode = acknowledged ? 'awaiting-visibility' : 'upload-outcome-unknown'
            }
            save()
            if (result.status === 'conflict' || result.status === 'present-unverifiable') return { state, statePath, code: 4 }
        }
        return { state, statePath, code: state.overall === 'complete' ? 0 : 6 }
    } finally {
        if (snapshotRoot) rmSync(snapshotRoot, { recursive: true, force: true })
        await unlock()
    }
}
