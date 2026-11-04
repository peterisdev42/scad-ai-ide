import { versionLabel, type InstalledLibrary, type RegistryLibrary } from './types'
import { repository } from './validation'

export function libraryIdentity(value: Pick<InstalledLibrary, 'libraryId' | 'repositoryUrl'>) {
    return JSON.stringify([value.libraryId, repository(value.repositoryUrl).url.toLowerCase()])
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
function tagParts(label: string) {
    const match = /^v?(\d+(?:\.\d+)*)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/i.exec(label)
    return match ? { numbers: match[1].split('.').map(Number), prerelease: match[2] ?? '' } : undefined
}
function compareTags(left: string, right: string) {
    const a = tagParts(left)!, b = tagParts(right)!
    for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
        const delta = (b.numbers[i] ?? 0) - (a.numbers[i] ?? 0)
        if (delta) return delta
    }
    if (!a.prerelease || !b.prerelease) return a.prerelease ? 1 : b.prerelease ? -1 : 0
    return natural.compare(b.prerelease, a.prerelease)
}

/** Keep one already-cached commit per repository, without fetching catalog data. */
export function latestCached(versions: readonly InstalledLibrary[], registry?: RegistryLibrary): InstalledLibrary {
    if (!versions.length) throw new Error('No cached versions.')
    const matching = registry && libraryIdentity(versions[0]) === libraryIdentity({ libraryId: registry.id, repositoryUrl: registry.repositoryUrl }) ? registry : undefined
    const latest = matching?.versions.find((version) => versionLabel(version) === matching.latestVersion)
    const declared = versions.find((version) => version.commit === latest?.commit)
    if (declared) return declared
    const tagged = versions.flatMap((entity) => entity.versions.filter((label) => tagParts(label)).map((label) => ({ entity, label })))
    tagged.sort((a, b) => compareTags(a.label, b.label) || b.entity.installedAt.localeCompare(a.entity.installedAt))
    if (tagged.length) return tagged[0].entity
    for (const version of matching?.versions ?? []) {
        const cached = versions.find((entity) => entity.commit === version.commit)
        if (cached) return cached
    }
    return [...versions].sort((a, b) => b.installedAt.localeCompare(a.installedAt) || a.commit.localeCompare(b.commit))[0]
}
