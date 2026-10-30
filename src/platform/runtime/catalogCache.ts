import { matchesRuntimeBuild, type RuntimeBuild, type RuntimeSystem } from './releases'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'

export interface RuntimeCatalogCache {
    version: 1
    builds: RuntimeBuild[]
    recommendedBuildId?: number
}

export function runtimeCatalogCacheKey(system: RuntimeSystem): string {
    return `runtime.catalog.v1.${system.platform}.${system.architecture}`
}

export function runtimeCatalogCachePath(storageRoot: string, system: RuntimeSystem): string {
    return path.join(storageRoot, 'cache', `runtime-catalog-${system.platform}-${system.architecture}.json`)
}

export async function loadLegacyRuntimeCatalogCache(storageRoot: string, system: RuntimeSystem): Promise<RuntimeCatalogCache | undefined> {
    try {
        return readRuntimeCatalogCache(JSON.parse(await readFile(runtimeCatalogCachePath(storageRoot, system), 'utf8')), system)
    } catch {
        // Missing, unreadable or damaged cache files must not prevent runtime discovery.
        return undefined
    }
}

/** Cached assets are installable, so validate their shape and download origin before reuse. */
export function readRuntimeCatalogCache(value: unknown, system: RuntimeSystem): RuntimeCatalogCache | undefined {
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('builds' in value) || !Array.isArray(value.builds)) return undefined
    const builds: RuntimeBuild[] = []
    for (const entry of value.builds) {
        if (!entry || typeof entry !== 'object') return undefined
        const build = entry as Partial<RuntimeBuild>
        if (typeof build.id !== 'number' || !Number.isSafeInteger(build.id) || build.id <= 0 || typeof build.release !== 'string' || typeof build.tag !== 'string' || typeof build.prerelease !== 'boolean' || typeof build.publishedAt !== 'string' || typeof build.name !== 'string' || !matchesRuntimeBuild(build.name, system) || typeof build.size !== 'number' || !Number.isFinite(build.size) || build.size < 0 || typeof build.downloadUrl !== 'string' || !URL.canParse(build.downloadUrl)) return undefined
        const url = new URL(build.downloadUrl)
        if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/peterisdev42/openscad-cli-builder/releases/download/') || url.username || url.password) return undefined
        if (build.checksumUrl !== undefined && build.checksumUrl !== `${build.downloadUrl}.sha256`) return undefined
        if (build.channel !== undefined && !['Stable', 'RC', 'Test', 'Snapshot', 'Unknown'].includes(build.channel)) return undefined
        if (build.upstreamCommit !== undefined && (typeof build.upstreamCommit !== 'string' || !/^[a-f0-9]{40}$/i.test(build.upstreamCommit))) return undefined
        builds.push(build as RuntimeBuild)
    }
    const recommendedBuildId = 'recommendedBuildId' in value && typeof value.recommendedBuildId === 'number' && builds.some((build) => build.id === value.recommendedBuildId && build.channel === 'Stable') ? value.recommendedBuildId : undefined
    return { version: 1, builds, recommendedBuildId }
}
