import { mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { assertCommit, git, readJson, requireRelease, writeJson } from '../common/io.mjs'
import { digest, orderedTargets, validatePlan } from '../common/schema.mjs'
import { markets, targetNames } from '../common/target-matrix.mjs'
import { assertMaintenance, gitTags, gitVersion, remoteFrozenPlans, repositoryFor, remoteReservation, reserveTag } from './git.mjs'
import { githubReleaseTags, marketHistory, validateMarketHistory } from './providers.mjs'
import { inventory, resolveVersion } from './resolve.mjs'

export function extensionIdentity(root, options) {
    const installed = readJson(resolve(root, 'package.json'))
    requireRelease(!options.publisher || !installed.publisher || installed.publisher === options.publisher,
        'Requested publisher differs from package.json')
    return { name: installed.name, publisher: installed.publisher || options.publisher }
}

export async function versionStatus(root, options, deps = {}) {
    const extension = extensionIdentity(root, options)
    const configurationMissing = !extension.publisher
    requireRelease(configurationMissing || (extension.publisher === extension.publisher.trim() && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(extension.publisher)), 'Invalid publisher')
    const repository = repositoryFor(root)
    let histories, occupied
    if (options.offline) {
        const fixture = readJson(options.offline)
        requireRelease(Object.keys(fixture).sort().join() === 'gitTags,openvsx,vscode' &&
            Array.isArray(fixture.gitTags) && fixture.gitTags.every(item => typeof item === 'string'), 'Invalid offline history')
        histories = markets.map(provider => {
            const versions = validateMarketHistory(fixture[provider])
            return { provider, complete: true, presence: versions.length ? 'present' : 'absent', versions }
        })
        occupied = { complete: true, versions: fixture.gitTags.map(gitVersion).filter(Boolean) }
    } else if (configurationMissing) {
        histories = markets.map(provider => ({ provider, complete: false, presence: 'unknown', versions: [], error: 'configurationMissing' }))
        occupied = { complete: false, versions: git(root, ['tag', '--list'], 2).split('\n').map(gitVersion).filter(Boolean) }
    } else {
        const [releasesResult, tagsResult, ...marketResults] = await Promise.allSettled([
            githubReleaseTags(repository, deps.fetcher), Promise.resolve().then(() => gitTags(root)),
            ...markets.map(market => marketHistory(market, extension, deps)),
        ])
        histories = marketResults.map((item, position) => item.status === 'fulfilled' ? item.value :
            { provider: markets[position], complete: false, presence: 'unknown', versions: [], error: 'market-query-failed' })
        const tags = tagsResult.status === 'fulfilled' ? tagsResult.value : []
        const releaseTags = releasesResult.status === 'fulfilled' ? releasesResult.value : []
        occupied = { complete: tagsResult.status === 'fulfilled' && releasesResult.status === 'fulfilled',
            versions: [...releaseTags, ...tags].map(gitVersion).filter(Boolean) }
        if (occupied.complete) {
            const tagged = new Set(tags.map(gitVersion).filter(Boolean))
            const uncertain = inventory(histories, occupied).releases
                .filter(item => tagged.has(item.version) && ['partial', 'conflict'].includes(item.status))
                .map(item => item.version)
            try {
                occupied.plans = remoteFrozenPlans(officialRemote({ repository }), repository, extension, uncertain)
            } catch {
                occupied.complete = false
                occupied.error = 'managed-tag-history-unavailable'
            }
        } else {
            occupied.error = 'git-history-unavailable'
        }
    }
    return { repository, extension, configurationMissing,
        ...(configurationMissing && { configurationHint: 'Verify the VS Code Marketplace publisher and Open VSX namespace, then pass --publisher <verified-publisher> or configure package.json.' }),
        offlineMock: Boolean(options.offline), histories, git: occupied,
        ...inventory(histories, occupied) }
}

export function resolveCandidate(status, options) {
    const cycle = options.cycle ?? (status.releases.length ? 'continue' : 'initial')
    const result = resolveVersion(status, { ...options, cycle, change: options.change ?? 'fix', name: status.extension.name })
    return { ...result, configurationMissing: status.configurationMissing, offlineMock: status.offlineMock }
}

export function writeDraft(root, status, result, options) {
    requireRelease(result.version, 'No new version is available', 4)
    requireRelease(status.extension.publisher, 'Set a verified publisher or provide an offline fixture identity')
    requireRelease(options.commit && options.out, 'Draft requires --commit and --out')
    requireRelease(options.out.endsWith('.draft.json'), 'Use a .draft.json filename for an unreserved draft')
    const changeAnalysis = options.analysis ? readJson(options.analysis) : {
        changeLevel: options.change ?? 'fix', summary: '', evidence: [], confidence: 0, needsReview: true,
    }
    requireRelease(changeAnalysis.changeLevel === (options.change ?? 'fix'), 'Analysis and requested change level differ')
    const plan = validatePlan({
        schemaVersion: 1, releaseId: `${status.extension.name}-v${result.version}`,
        repository: status.repository, extension: status.extension, version: result.version, channel: result.channel,
        preRelease: result.channel === 'preview', sourceCommit: assertCommit(root, options.commit),
        tag: `v${result.version}`, targets: orderedTargets(options.target ?? targetNames),
        changeAnalysis, status: 'draft-unreserved', ...(status.offlineMock && { offlineMock: true }),
        ...(result.reason === 'hotfix' && { maintenanceTag: `v${options.base}` }),
    })
    assertMaintenance(root, plan, options.maintenanceRef)
    mkdirSync(dirname(resolve(options.out)), { recursive: true })
    writeJson(options.out, plan, { immutable: true })
    return { plan, planSha256: digest(plan), file: resolve(options.out), availability: result.status }
}

export function verifyVersionPlan(root, plan, options) {
    validatePlan(plan)
    const extension = extensionIdentity(root, options)
    requireRelease(extension.name === plan.extension.name && (!extension.publisher ||
        extension.publisher === plan.extension.publisher) && repositoryFor(root) === plan.repository, 'Plan repository or extension mismatch', 4)
    assertCommit(root, plan.sourceCommit)
    assertMaintenance(root, plan, options.maintenanceRef)
    return { planSha256: digest(plan), sourceVerified: true }
}

export const officialRemote = plan => `https://github.com/${plan.repository}.git`

export async function reserveVersion(root, draft, options) {
    validatePlan(draft)
    requireRelease(draft.status === 'draft-unreserved', 'Reserve requires a draft')
    const { status, offlineMock, ...plan } = draft
    const base = { dryRun: !options.apply, releaseId: plan.releaseId, tag: plan.tag, planSha256: digest(plan),
        sourceCommit: plan.sourceCommit, offlineMock: Boolean(offlineMock) }
    if (!options.apply) return base
    requireRelease(!offlineMock && !options.offline && options.confirmRelease === plan.releaseId &&
        options.out && basename(options.out) === 'release-plan.json', 'Reservation requires a live draft, --confirm-release and --out ending in release-plan.json')
    verifyVersionPlan(root, draft, options)
    requireRelease(extensionIdentity(root, options).publisher === plan.extension.publisher,
        'Configure the authorized publisher before reserving')
    const remote = officialRemote(plan)
    let reserved = remoteReservation(remote, plan)
    if (!reserved) {
        const current = await versionStatus(root, options)
        requireRelease(current.complete, 'Cannot reserve with incomplete remote history', 3)
        requireRelease(!current.releases.some(item => item.version === plan.version || ['reserved', 'partial', 'conflict'].includes(item.status)),
            'Resolve existing occupied, partial or reserved versions first', 4)
        if (plan.maintenanceTag) {
            requireRelease(current.releases.some(item => item.version === plan.maintenanceTag.slice(1) && item.status === 'occupied'),
                'Stable hotfix base is not a completed release', 4)
        }
        reserved = reserveTag(root, git(root, ['remote', 'get-url', 'origin'], 2), plan)
    }
    const directory = dirname(resolve(options.out))
    const statePath = join(directory, 'release-state.json')
    try {
        mkdirSync(directory, { recursive: true })
        writeJson(options.out, plan, { immutable: true })
        writeJson(statePath, { schemaVersion: 1, releaseId: plan.releaseId, planSha256: digest(plan), sourceCommit: plan.sourceCommit,
            tag: plan.tag, tagObject: reserved.tagObject, status: 'reserved' }, { immutable: true })
    } catch {
        return { ...base, status: 'reserved-incomplete', code: 5, remotePlan: reserved,
            recovery: 'Retry with the same draft and another frozen output path' }
    }
    return { ...base, ...reserved, file: resolve(options.out), statePath }
}
