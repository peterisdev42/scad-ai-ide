import type { Layout, Registry, Manifest, Lockfile } from './types'
import { auditedLayouts } from './layouts'
export function object(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
    return value as Record<string, any>
}
export function text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty text.')
    return value
}
export function id(value: unknown): string {
    const s = safePart(text(value))
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) throw new Error('Invalid library ID.')
    return s
}
export function sha(value: unknown): string {
    const s = text(value)
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(s)) throw new Error('Expected a full commit SHA.')
    return s.toLowerCase()
}
export function safePart(value: unknown): string {
    const s = text(value)
    if (/[<>:"/\\|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s) || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(s)) throw new Error(`Unsafe path component: ${s}`)
    return s
}
export function relativeRoot(value: unknown): string {
    const s = text(value)
    if (s !== '.') s.split('/').forEach(safePart)
    return s
}
export function layout(value: unknown): Layout {
    const v = object(value)
    return { includeName: safePart(v.includeName), includeRoot: relativeRoot(v.includeRoot) }
}
export function repository(value: unknown) {
    const u = new URL(text(value))
    const m = /^\/([\w.-]+)\/([\w.-]+?)\/?$/.exec(u.pathname)
    if (u.protocol !== 'https:' || !['github.com', 'codeberg.org'].includes(u.hostname) || u.username || u.password || u.port || u.search || u.hash || !m) throw new Error('Unsupported repository URL.')
    m.slice(1).forEach(safePart)
    const repo = m[2].replace(/\.git$/, '')
    safePart(repo)
    return { provider: u.hostname === 'github.com' ? ('github' as const) : ('codeberg' as const), url: `https://${u.hostname}/${m[1]}/${repo}` }
}
export function archiveUrl(repo: string, commit: string) {
    return `${repository(repo).url}/archive/${sha(commit)}.zip`
}
export function parseRegistry(value: unknown): Registry {
    const v = object(value)
    if (![1, 2].includes(v.schemaVersion) || !Number.isFinite(Date.parse(v.generatedAt)) || !Array.isArray(v.libraries)) throw new Error('Unsupported Registry schema.')
    const ids = new Set<string>()
    for (const raw of v.libraries) {
        const l = object(raw)
        id(l.id)
        if (ids.has(l.id)) throw new Error('Duplicate library ID.')
        ids.add(l.id)
        for (const key of ['name', 'description', 'license']) text(l[key])
        repository(l.repositoryUrl)
        const doc = new URL(text(l.documentationUrl))
        if (doc.protocol !== 'https:' || doc.username || doc.password) throw new Error('Unsafe documentation URL.')
        if (!['ok', 'stale', 'error'].includes(object(l.sync).status) || !Array.isArray(l.versions)) throw new Error('Invalid registry sync state.')
        if (l.layout !== undefined) layout(l.layout)
        delete l.validationError
        const tags = new Set<string>()
        let snapshots = 0
        for (const rawVersion of l.versions) {
            const r = object(rawVersion)
            r.commit = sha(r.commit)
            if (r.kind === 'tag') {
                text(r.tag)
                if (tags.has(r.tag)) throw new Error('Duplicate tag.')
                tags.add(r.tag)
            } else if (r.kind === 'snapshot' && r.tag === null) {
                snapshots++
            } else throw new Error('Invalid registry version.')
            if (r.prerelease !== null && typeof r.prerelease !== 'boolean') throw new Error('Invalid prerelease value.')
            const download = new URL(text(r.downloadUrl))
            if (download.protocol !== 'https:' || download.username || download.password || download.port || download.search || download.hash || !['github.com', 'codeberg.org'].includes(download.hostname) || !new RegExp(`^/[^/]+/[^/]+/archive/${r.commit}\\.zip$`, 'i').test(download.pathname)) throw new Error('Archive must be pinned to an exact commit on an approved host.')
            if (r.downloadUrl.toLowerCase() !== archiveUrl(l.repositoryUrl, r.commit).toLowerCase()) l.validationError = 'Archive repository differs from Registry repository identity. Installation is disabled pending Registry correction.'
            if (r.layout !== undefined) layout(r.layout)
        }
        if (snapshots > 1 || (snapshots && tags.size) || (l.latestVersion !== null && !tags.has(l.latestVersion)) || (l.sync.status !== 'error' && !l.versions.length)) throw new Error('Inconsistent registry versions.')
    }
    return v as unknown as Registry
}
export function parseManifest(value: unknown): Manifest {
    const v = object(value)
    if (v.manifestVersion !== 1) throw new Error('Unsupported dependency manifest.')
    for (const [key, dep] of Object.entries(object(v.dependencies))) {
        id(key)
        const version = text(object(dep).version)
        if (/^[~^*]|[<>=|]/.test(version)) throw new Error('Only exact versions are supported.')
    }
    return v as unknown as Manifest
}
export function parseLockfile(value: unknown): Lockfile {
    const v = object(value)
    if (v.lockVersion !== 1) throw new Error('Unsupported dependency lockfile.')
    const names = new Set<string>()
    for (const [key, raw] of Object.entries(object(v.dependencies))) {
        id(key)
        const dep = object(raw)
        const source = object(dep.source)
        const repo = repository(source.repositoryUrl)
        if (source.provider !== repo.provider) throw new Error('Repository provider mismatch.')
        const r = object(dep.resolved)
        sha(r.commit)
        if (!(r.kind === 'tag' && typeof r.tag === 'string' && r.tag.length) && !(r.kind === 'snapshot' && r.tag === null)) throw new Error('Invalid locked version.')
        const m = object(dep.mount)
        safePart(m.name)
        relativeRoot(m.includeRoot)
        const name = m.name.normalize('NFC').toLowerCase()
        if (names.has(name)) throw new Error('Dependency mount names collide.')
        names.add(name)
    }
    return v as unknown as Lockfile
}
// Audited repository identity and required entry point; every downloaded commit is checked again.
export function installLayout(library: { id: string; repositoryUrl: string; layout?: Layout }, version?: { layout?: Layout; commit?: string }): Layout {
    const explicit = version?.layout ?? library.layout
    if (explicit) return layout(explicit)
    if (library.id === 'bosl2' && repository(library.repositoryUrl).url.toLowerCase() === 'https://github.com/belfryscad/bosl2') return { includeName: 'BOSL2', includeRoot: '.' }
    const audited = auditedLayouts.find((entry) => entry.id === library.id && repository(entry.repositoryUrl).url.toLowerCase() === repository(library.repositoryUrl).url.toLowerCase())
    if (audited?.blockedReason) throw new Error(audited.blockedReason)
    if (audited?.includeName && audited.includeRoot) {
        if (version?.commit && version.commit !== audited.commit) throw new Error('This commit has not been audited. Registry v2 layout metadata is required.')
        return { includeName: audited.includeName, includeRoot: audited.includeRoot }
    }
    throw new Error('Installation layout has not been audited for this library. Registry v2 layout metadata is required.')
}
