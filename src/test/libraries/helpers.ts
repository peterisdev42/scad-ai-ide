import { mkdtemp, realpath, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import type { Registry, RegistryLibrary, LockedDependency } from '../../core/libraries/types'
import { GlobalLibraryStore } from '../../platform/libraries/GlobalLibraryStore'
import { RegistryClient } from '../../platform/libraries/RegistryClient'
import { LibraryInstaller } from '../../platform/libraries/LibraryInstaller'
import { ProjectDependencyManager } from '../../platform/libraries/ProjectDependencyManager'
import type { LibraryLinker } from '../../platform/libraries/LibraryLinker'
export const commitA = 'a'.repeat(40),
    commitB = 'b'.repeat(40)
export const repo = 'https://github.com/example/fixture'
export function library(): RegistryLibrary {
    return { id: 'fixture', name: 'Fixture Library', description: 'A test fixture', license: 'MIT', repositoryUrl: repo, documentationUrl: repo, layout: { includeName: 'fixture-library', includeRoot: '.' }, latestVersion: 'v2', sync: { status: 'ok' }, versions: [commitA, commitB].map((commit, i) => ({ kind: 'tag', tag: `v${i + 1}`, commit, prerelease: false, downloadUrl: `${repo}/archive/${commit}.zip` })) }
}
export const registry = (): Registry => ({ schemaVersion: 2, generatedAt: '2026-11-03T00:00:00Z', libraries: [library()] })
export function locked(commit = commitA): LockedDependency {
    return { source: { provider: 'github', repositoryUrl: repo }, resolved: { kind: 'tag', tag: commit === commitA ? 'v1' : 'v2', commit }, mount: { name: 'fixture-library', includeRoot: '.' } }
}
export const archive = (commit = commitA) => zipSync({ 'fixture-root/smoke.scad': strToU8(`module test_shape() { cube(${commit === commitA ? 10 : 20}); }`) })
export async function fixture(linker?: LibraryLinker) {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'scad-library-')))
    const project = path.join(root, '项目 A')
    await mkdir(project)
    const store = new GlobalLibraryStore(path.join(root, 'global'))
    let downloads = 0,
        online = true
    const request: typeof fetch = async (input) => {
        if (!online) throw new Error('offline')
        if (String(input).includes('/archive/')) {
            downloads++
            return new Response(Buffer.from(archive(String(input).includes(commitB) ? commitB : commitA)))
        }
        return new Response(JSON.stringify(registry()), { headers: { etag: 'fixture-etag' } })
    }
    const client = new RegistryClient(store.root, request)
    const installer = new LibraryInstaller(store, request)
    const changes: string[] = []
    const manager = new ProjectDependencyManager(store, client, installer, linker, (root) => changes.push(root))
    return {
        root,
        project,
        store,
        client,
        installer,
        manager,
        changes,
        request,
        downloads: () => downloads,
        offline: () => {
            online = false
        },
        cleanup: () => rm(root, { recursive: true, force: true }),
    }
}
