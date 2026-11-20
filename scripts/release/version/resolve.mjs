import { markets, targetNames } from '../common/target-matrix.mjs'
import { parseVersion, versionChannel } from '../common/schema.mjs'
import { requireRelease } from '../common/io.mjs'

function compareVersions(left, right) {
    const a = parseVersion(left)
    const b = parseVersion(right)
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export function inventory(histories, gitVersions, releaseTargets = targetNames) {
    const complete = histories.every(history => history.complete) && gitVersions.complete
    const versions = new Set([...gitVersions.versions, ...histories.flatMap(history => history.versions.map(item => item.version))])
    const releases = [...versions].sort(compareVersions).map(version => {
        const byMarket = Object.fromEntries(markets.map(market => {
            const history = histories.find(item => item.provider === market)
            const entries = history.versions.filter(item => item.version === version)
            return [market, { presence: !history.complete ? 'unknown' : entries.length ? 'present' : 'absent', entries }]
        }))
        const records = Object.values(byMarket).flatMap(item => item.entries)
        const expectedTargets = gitVersions.plans?.[version]?.targets ?? releaseTargets
        let status = 'unknown'
        if (records.some(item => item.preRelease !== (versionChannel(version) === 'preview') ||
            !expectedTargets.includes(item.target))) status = 'conflict'
        else if (complete) {
            if (records.length === 0) status = 'reserved'
            else if (records.length === expectedTargets.length * markets.length) status = 'occupied'
            else status = 'partial'
        }
        return { version, status, markets: byMarket }
    })
    return { complete, releases }
}

export function resolveVersion(state, { channel, change, cycle, base, major, approved, name }) {
    requireRelease(['stable', 'preview'].includes(channel), 'Choose --channel stable or preview')
    requireRelease(['none', 'fix', 'feature', 'breaking'].includes(change), 'Invalid --change')
    requireRelease(['initial', 'continue', 'next', 'promote', 'hotfix', 'major'].includes(cycle), 'Invalid --cycle')
    const recover = state.releases.filter(item => ['partial', 'reserved', 'conflict'].includes(item.status))
    if (recover.length) return { status: 'recoveryRequired', releases: recover.map(item => ({
        ...item, releaseId: `${name}-v${item.version}`,
    })) }
    requireRelease(change !== 'breaking' || (cycle === 'major' && approved), 'Breaking changes require an approved Major cycle')
    if (change === 'none') return { status: 'no-change' }
    const occupied = state.releases.map(item => item.version)
    let next
    if (cycle === 'major') {
        requireRelease(approved && typeof major === 'string' && /^(0|[1-9][0-9]*)$/.test(major) &&
            Number.isSafeInteger(Number(major)) && occupied.every(item => parseVersion(item)[0] < Number(major)),
        'Use --approve --major with a new Major number')
        next = [Number(major), channel === 'preview' ? 1 : 2, 0]
    } else if (cycle === 'initial') {
        requireRelease(occupied.length === 0, 'Initial cycle requires an empty release history', 4)
        next = [0, channel === 'preview' ? 1 : 2, 0]
    } else {
        const latest = base ?? occupied.filter(item => versionChannel(item) ===
            ({ promote: 'preview', next: 'stable' }[cycle] ?? channel)).at(-1)
        requireRelease(latest && occupied.includes(latest), 'An existing base version is required')
        const [currentMajor, minor, patch] = parseVersion(latest)
        if (cycle === 'promote' || cycle === 'next') {
            requireRelease(approved && ((cycle === 'promote' && minor % 2 === 1 && channel === 'stable') ||
                (cycle === 'next' && minor % 2 === 0 && channel === 'preview')), 'Cycle transition requires approval and a matching base channel')
            next = [currentMajor, minor + 1, 0]
        } else if (cycle === 'hotfix') {
            requireRelease(base && minor % 2 === 0 && channel === 'stable' && change === 'fix',
                'Stable hotfix requires an explicit Stable base version')
            next = [currentMajor, minor, patch + 1]
        } else {
            requireRelease(channel === 'preview' && minor % 2 === 1, 'Use hotfix or promote for Stable releases')
            next = [currentMajor, minor, patch + 1]
        }
    }
    parseVersion(next.join('.'))
    requireRelease(!occupied.includes(next.join('.')), 'Candidate already occupied; review the selected cycle/base', 4)
    return { status: state.complete ? 'available' : 'candidate-unverified', version: next.join('.'), channel, reason: cycle }
}
