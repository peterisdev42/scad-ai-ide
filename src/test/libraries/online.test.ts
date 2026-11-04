import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdtemp, realpath, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GlobalLibraryStore } from '../../platform/libraries/GlobalLibraryStore'
import { RegistryClient } from '../../platform/libraries/RegistryClient'
import { LibraryInstaller } from '../../platform/libraries/LibraryInstaller'
import { ProjectDependencyManager } from '../../platform/libraries/ProjectDependencyManager'
import { LibraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { versionLabel } from '../../core/libraries/types'
test('Online BOSL2: Registry → commit archive → global Store → project link → real CLI → offline Restore', { skip: process.env.SCAD_LIBRARIES_ONLINE !== '1', timeout: 180000 }, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'scad-bosl2-')))
    try {
        const project = path.join(root, 'project')
        await mkdir(project)
        const store = new GlobalLibraryStore(path.join(root, 'global'))
        const registry = new RegistryClient(store.root)
        const manager = new ProjectDependencyManager(store, registry, new LibraryInstaller(store))
        const library = await registry.getLibrary('bosl2')
        const version = library.versions.find((v) => v.tag === library.latestVersion)
        assert.ok(version, 'Registry must declare a latest BOSL2 version for this smoke test')
        await manager.install(project, 'bosl2', versionLabel(version))
        const source = path.join(project, 'main.scad')
        const output = path.join(root, 'bosl2.stl')
        await writeFile(source, 'include <BOSL2/std.scad>; cuboid([10, 12, 14], rounding=1);')
        const env = new LibraryEnvironment()
        env.configure(() => [project])
        await promisify(execFile)(process.env.SCAD_OPENSCAD_EXECUTABLE ?? 'openscad', ['-o', output, source], { env: await env.getEnvironment(source), timeout: 60000 })
        assert.ok((await stat(output)).size > 0)
        await rm(path.join(project, '.scad/lib'), { recursive: true })
        const offline = new ProjectDependencyManager(
            store,
            new RegistryClient(store.root, async () => {
                throw new Error('offline')
            }),
            new LibraryInstaller(store, async () => {
                throw new Error('offline')
            }),
        )
        await offline.restore(project)
        assert.equal((await offline.list(project))[0].status, 'Ready')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
