import { anonymousGitHubRequest, type GitHubRequest } from '../github/client'
import { parse } from 'yaml'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describeRequestError, requestGitHub } from '../github/errors'
import type { RuntimeReleaseChannel } from '../../core/runtime/types'

export type { RuntimeReleaseChannel } from '../../core/runtime/types'

export const releasesApi = 'https://api.github.com/repos/peterisdev42/openscad-cli-builder/releases'

export interface RuntimeSystem {
    platform: string
    name: string
    version: string
    architecture: string
}

export interface RuntimeBuild {
    id: number
    release: string
    tag: string
    prerelease: boolean
    publishedAt: string
    name: string
    size: number
    downloadUrl: string
    checksumUrl?: string
    channel?: RuntimeReleaseChannel
    upstreamCommit?: string
}

interface ReleaseIdentity {
    tag_name: string
    body?: unknown
    prerelease?: unknown
    draft?: unknown
}

interface ReleaseMetadata {
    schemaVersion: 1
    version: string
    channel: 'stable' | 'rc' | 'test' | 'snapshot'
    upstream: { repository: string; commit: string; snapshotUrl?: string }
}

const channelLabels: Record<ReleaseMetadata['channel'], RuntimeReleaseChannel> = { stable: 'Stable', rc: 'RC', test: 'Test', snapshot: 'Snapshot' }

export function readReleaseMetadata(release: ReleaseIdentity): ReleaseMetadata | undefined {
    const match = typeof release.body === 'string' && /^\s*```yaml\r?\n([\s\S]*?)\r?\n```/.exec(release.body)
    if (!match) return undefined
    try {
        const data = parse(match[1]) as ReleaseMetadata | null
        if (!data || data.schemaVersion !== 1 || !Object.hasOwn(channelLabels, data.channel) || typeof data.version !== 'string' || release.tag_name !== `openscad-${data.version}` || typeof data.upstream?.repository !== 'string' || !data.upstream.repository.trim() || typeof data.upstream.commit !== 'string' || !/^[a-f0-9]{40}$/i.test(data.upstream.commit) || typeof release.prerelease !== 'boolean' || release.prerelease !== (data.channel !== 'stable') || (data.upstream.snapshotUrl !== undefined && typeof data.upstream.snapshotUrl !== 'string')) {
            return undefined
        }
        return data
    } catch {
        return undefined
    }
}

export function classifyRuntimeRelease(release: ReleaseIdentity): RuntimeReleaseChannel {
    if (release.draft) return 'Unknown'
    const metadata = readReleaseMetadata(release)
    if (metadata) return channelLabels[metadata.channel]
    // Legacy releases have no structured metadata. A date alone never implies Snapshot.
    if (/-RC\d+$/i.test(release.tag_name)) return 'RC'
    if (/-TEST\d+$/i.test(release.tag_name)) return 'Test'
    if (release.prerelease === false) return 'Stable'
    return 'Unknown'
}

function releaseSortDate(build: RuntimeBuild): number {
    const match = /^(?:OpenSCAD(?: CLI)?\s+)?(\d{4})\.(\d{2})\.(\d{2})(?:-|$)/i.exec(build.release.trim())
    if (match) {
        const [, year, month, day] = match
        const timestamp = Date.UTC(+year, +month - 1, +day)
        const date = new Date(timestamp)
        if (date.getUTCFullYear() === +year && date.getUTCMonth() === +month - 1 && date.getUTCDate() === +day) return timestamp
    }
    // Builder publication time is only a fallback when the upstream date is unavailable.
    return Date.parse(build.publishedAt) || 0
}

async function requestReleaseData(url: string, request: GitHubRequest): Promise<unknown> {
    const response = await requestGitHub(request, url, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'scad-ai-ide' },
        signal: AbortSignal.timeout(15000),
    })
    try {
        return await response.json()
    } catch (error) {
        throw new Error(`Invalid JSON response from GitHub API (HTTP ${response.status}).\nRequest: ${url}\n${describeRequestError(error)}`, { cause: error })
    }
}

/** Recommendation comes from GitHub Latest, independently of the version list order. */
export async function fetchLatestRuntimeTag(request: GitHubRequest = anonymousGitHubRequest): Promise<string | undefined> {
    const release = await requestReleaseData(`${releasesApi}/latest`, request)
    if (!release || typeof release !== 'object' || !('tag_name' in release) || typeof release.tag_name !== 'string') {
        throw new Error('Invalid GitHub Latest Release response: expected a release with tag_name.')
    }
    return classifyRuntimeRelease({ ...release, tag_name: release.tag_name }) === 'Stable' ? release.tag_name : undefined
}

export function normalizeArchitecture(value: string): string {
    const architecture = value.toLowerCase()
    if (['x64', 'x86_64', 'amd64'].includes(architecture)) {
        return 'x64'
    }
    if (['ia32', 'x86', 'i386', 'i686'].includes(architecture)) {
        return 'x86'
    }
    if (['arm64', 'aarch64'].includes(architecture)) {
        return 'arm64'
    }
    return architecture
}

export async function detectRuntimeSystem(): Promise<RuntimeSystem> {
    let version = os.release()
    if (process.platform === 'darwin') {
        try {
            version = (await promisify(execFile)('/usr/bin/sw_vers', ['-productVersion'], { timeout: 3000 })).stdout.trim()
        } catch {
            version = `Darwin ${version}`
        }
    }
    return {
        platform: process.platform,
        name: ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[process.platform] ?? os.type(),
        version,
        // machine() identifies the host CPU even when Node runs under emulation.
        architecture: normalizeArchitecture(process.platform === 'win32' ? process.env.PROCESSOR_ARCHITEW6432 || os.machine() : os.machine()),
    }
}

export function matchesRuntimeBuild(name: string, system: RuntimeSystem): boolean {
    const match = /^openscad-cli-(macos|windows|linux)-(arm64|aarch64|x86_64|amd64|x64|x86|ia32)\.(tar\.gz|zip)$/.exec(name)
    const platform = ({ darwin: 'macos', win32: 'windows', linux: 'linux' } as Record<string, string>)[system.platform]
    return !!match && match[1] === platform && normalizeArchitecture(match[2]) === system.architecture
}

export async function fetchRuntimeBuilds(system: RuntimeSystem, request: GitHubRequest = anonymousGitHubRequest): Promise<RuntimeBuild[]> {
    const builds: RuntimeBuild[] = []
    const seen = new Set<number>()
    // Keep pagination on the fixed repository endpoint; never follow arbitrary URLs from a response.
    for (let page = 1; ; page++) {
        const url = `${releasesApi}?per_page=100&page=${page}`
        const response = await requestGitHub(request, url, {
            headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'scad-ai-ide' },
            signal: AbortSignal.timeout(15000),
        })
        let releases: unknown
        try {
            releases = await response.json()
        } catch (error) {
            throw new Error(`Invalid JSON response from GitHub API (HTTP ${response.status}).\nRequest: ${url}\n${describeRequestError(error)}`, { cause: error })
        }
        if (!Array.isArray(releases)) {
            throw new Error(`Invalid GitHub Releases response: expected a release list (HTTP ${response.status}).\nRequest: ${url}\nResponse: ${JSON.stringify(releases)}`)
        }
        for (const release of releases) {
            if (!release || release.draft || !Array.isArray(release.assets) || typeof release.tag_name !== 'string') {
                continue
            }
            for (const asset of release.assets) {
                if (!asset || typeof asset.id !== 'number' || typeof asset.name !== 'string' || !matchesRuntimeBuild(asset.name, system) || typeof asset.browser_download_url !== 'string' || !URL.canParse(asset.browser_download_url) || seen.has(asset.id)) {
                    continue
                }
                const url = new URL(asset.browser_download_url)
                if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/peterisdev42/openscad-cli-builder/releases/download/')) {
                    continue
                }
                seen.add(asset.id)
                const checksum = release.assets.find((entry: { name?: unknown }) => entry?.name === `${asset.name}.sha256`)
                const checksumUrl = typeof checksum?.browser_download_url === 'string' && checksum.browser_download_url === `${url.toString()}.sha256` ? checksum.browser_download_url : undefined
                builds.push({
                    id: asset.id,
                    release: typeof release.name === 'string' && release.name ? release.name : release.tag_name,
                    tag: release.tag_name,
                    prerelease: release.prerelease === true,
                    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
                    name: asset.name,
                    size: typeof asset.size === 'number' ? asset.size : 0,
                    downloadUrl: url.toString(),
                    checksumUrl,
                    channel: classifyRuntimeRelease(release),
                    upstreamCommit: readReleaseMetadata(release)?.upstream.commit,
                })
            }
        }
        if (!response.headers.get('link')?.includes('rel="next"')) {
            return builds.sort((a, b) => releaseSortDate(b) - releaseSortDate(a) || a.tag.localeCompare(b.tag) || a.id - b.id)
        }
    }
}
