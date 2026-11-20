import { setTimeout as delay } from 'node:timers/promises'
import { ReleaseError, requireRelease } from '../common/io.mjs'
import { parseVersion } from '../common/schema.mjs'

const marketplace = 'https://marketplace.visualstudio.com'
const openvsx = 'https://open-vsx.org'
const preReleaseKey = 'Microsoft.VisualStudio.Code.PreRelease'
const safeHttpError = status => new ReleaseError(3, `Remote HTTP ${status}`)

export async function request(url, { fetcher = fetch, allow404 = false, ...options } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15_000), redirect: 'error' })
            if ((allow404 && response.status === 404) || response.ok) return response
            await response.body?.cancel()
            if (response.status !== 429 && response.status < 500) throw safeHttpError(response.status)
            if (attempt === 2) throw safeHttpError(response.status)
        } catch (error) {
            if (error instanceof ReleaseError) throw error
            if (attempt === 2) throw new ReleaseError(3, 'Remote request failed')
        }
        await delay(150 * 2 ** attempt)
    }
}

async function readResponse(response, maxBytes) {
    const chunks = []
    let size = 0
    for await (const chunk of response.body ?? []) {
        size += chunk.length
        if (size > maxBytes) return null
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

const json = async (url, options) => {
    const response = await request(url, options)
    if (response.status === 404) return null
    const contents = await readResponse(response, 16 * 1024 * 1024)
    requireRelease(contents?.length, 'Invalid or oversized remote JSON', 3)
    return JSON.parse(contents)
}

const platform = value => {
    const target = value ?? 'universal'
    requireRelease(typeof target === 'string' && /^[a-z0-9-]+$/.test(target), 'Invalid market target', 3)
    return target
}

function vsCodePath(extension, version, target) {
    const suffix = target === 'universal' ? '' : `?targetPlatform=${encodeURIComponent(target)}`
    return `${marketplace}/_apis/public/gallery/publishers/${extension.publisher}/vsextensions/${extension.name}/${version}/vspackage${suffix}`
}

function openVsxPath(extension, version, target) {
    return `${openvsx}/api/${extension.publisher}/${extension.name}/${target}/${version}`
}

async function vscodeVersions(extension, fetcher) {
    const query = {
        filters: [{ criteria: [{ filterType: 7, value: `${extension.publisher}.${extension.name}` }],
            pageNumber: 1, pageSize: 2, sortBy: 0, sortOrder: 0 }],
        // IncludeVersions, IncludeVersionProperties and IncludeAssetUri.
        flags: 145, assetTypes: [],
    }
    const result = await json(`${marketplace}/_apis/public/gallery/extensionquery`, {
        fetcher, method: 'POST', body: JSON.stringify(query),
        headers: { accept: 'application/json;api-version=3.0-preview.1', 'content-type': 'application/json' },
    })
    requireRelease(result?.results?.length === 1 && Array.isArray(result.results[0].extensions) &&
        result.results[0].extensions.length <= 1, 'Invalid Marketplace query result', 3)
    const entry = result.results[0].extensions[0]
    if (!entry) return []
    requireRelease(entry.extensionName?.toLowerCase() === extension.name.toLowerCase() &&
        entry.publisher?.publisherName?.toLowerCase() === extension.publisher.toLowerCase() &&
        Array.isArray(entry.versions) && entry.versions.length > 0, 'Incomplete Marketplace extension history', 3)
    return entry.versions.map(item => {
        const target = platform(item.targetPlatform)
        requireRelease(Array.isArray(item.properties) && item.properties.every(property =>
            typeof property.key === 'string' && typeof property.value === 'string'), 'Missing Marketplace version properties', 3)
        const marker = item.properties.filter(property => property.key === preReleaseKey)
        requireRelease(marker.length <= 1 && (!marker[0] || ['true', 'false'].includes(marker[0].value)),
            'Invalid Marketplace pre-release property', 3)
        return { version: item.version, target, preRelease: marker[0]?.value === 'true' }
    })
}

async function openVsxVersions(extension, fetcher) {
    const endpoint = `${openvsx}/api/${extension.publisher}/${extension.name}`
    const listing = await json(endpoint, { fetcher, allow404: true })
    if (listing === null) return []
    requireRelease(listing.namespace === extension.publisher && listing.name === extension.name &&
        listing.allVersions && typeof listing.allVersions === 'object' && !Array.isArray(listing.allVersions),
        'Invalid Open VSX extension metadata', 3)
    const references = []
    let total
    do {
        const page = await json(`${endpoint}/version-references?size=100&offset=${references.length}`, { fetcher })
        requireRelease(page?.offset === references.length && Number.isSafeInteger(page.totalSize) &&
            page.totalSize > 0 && page.totalSize <= 10_000 && (total === undefined || total === page.totalSize) &&
            Array.isArray(page.versions) && page.versions.length > 0 &&
            references.length + page.versions.length <= page.totalSize, 'Incomplete Open VSX version history', 3)
        total = page.totalSize
        references.push(...page.versions)
    } while (references.length < total)
    const versions = []
    for (let offset = 0; offset < references.length; offset += 8) {
        versions.push(...await Promise.all(references.slice(offset, offset + 8).map(async item => {
            const target = platform(item.targetPlatform)
            parseVersion(item.version)
            const metadata = await json(openVsxPath(extension, item.version, target), { fetcher })
            requireRelease(metadata?.namespace === extension.publisher && metadata.name === extension.name &&
                metadata.version === item.version && platform(metadata.targetPlatform) === target &&
                typeof metadata.preRelease === 'boolean', 'Incomplete Open VSX version metadata', 3)
            return { version: item.version, target, preRelease: metadata.preRelease }
        })))
    }
    const enumerated = new Set(versions.map(item => item.version))
    requireRelease(Object.keys(listing.allVersions).filter(key => !['latest', 'pre-release'].includes(key))
        .every(key => enumerated.has(key)), 'Open VSX metadata and history disagree', 3)
    return versions
}

export function validateMarketHistory(versions) {
    requireRelease(Array.isArray(versions), 'Invalid market history', 3)
    const keys = new Set()
    for (const item of versions) {
        parseVersion(item.version)
        requireRelease(typeof item.target === 'string' && platform(item.target) === item.target &&
            typeof item.preRelease === 'boolean', 'Invalid version metadata', 3)
        requireRelease(!keys.has(`${item.version}/${item.target}`), 'Duplicate version metadata', 3)
        keys.add(`${item.version}/${item.target}`)
    }
    return versions
}

export async function marketHistory(provider, extension, { fetcher } = {}) {
    const context = { provider, extensionId: `${extension.publisher}.${extension.name}`, fetchedAt: new Date().toISOString() }
    try {
        const versions = validateMarketHistory(await (provider === 'vscode' ? vscodeVersions : openVsxVersions)(extension, fetcher))
        return { ...context, complete: true, presence: versions.length ? 'present' : 'absent', versions }
    } catch (error) {
        return { ...context, complete: false, presence: 'unknown', versions: [],
            error: error instanceof ReleaseError && error.code === 3 ? error.message : 'Bad remote metadata' }
    }
}

export async function remotePackage(provider, extension, version, target, { fetcher = fetch, maxBytes } = {}) {
    let url = vsCodePath(extension, version, target)
    if (provider === 'openvsx') {
        const item = await json(openVsxPath(extension, version, target), { fetcher })
        if (item?.namespace !== extension.publisher || item.name !== extension.name || item.version !== version ||
            platform(item.targetPlatform) !== target || typeof item.files?.download !== 'string') return null
        const download = new URL(item.files.download)
        if (download.origin !== openvsx || download.username || download.password || download.search || download.hash ||
            !download.pathname.startsWith(`/api/${extension.publisher}/${extension.name}/`) ||
            !download.pathname.endsWith('/' + extension.publisher + '.' + extension.name + '-' + version + '.vsix')) return null
        url = download.href
    }
    const response = await fetcher(url, { signal: AbortSignal.timeout(45_000), redirect: 'follow' })
    return response.ok ? readResponse(response, maxBytes) : null
}

export async function githubReleaseTags(repository, fetcher) {
    const list = []
    for (let page = 1; page <= 100; page++) {
        const entries = await json(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, {
            fetcher, headers: { accept: 'application/vnd.github+json' },
        })
        requireRelease(Array.isArray(entries) && entries.every(item => typeof item.tag_name === 'string'),
            'Invalid GitHub release history', 3)
        list.push(...entries.map(item => item.tag_name))
        if (entries.length < 100) return list
    }
    throw new ReleaseError(3, 'Incomplete GitHub release history')
}
