import * as path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { parseLockfile, parseManifest, repository } from '../../core/libraries/validation'
import type { InstalledLibrary } from '../../core/libraries/types'
import { atomicJson, exists, readJson } from './files'
export class LibraryReferenceIndex {
    constructor(private readonly root: string) {}
    async register(project: string) {
        const projects = await this.projects()
        if (!projects.includes(project)) projects.push(project)
        await atomicJson(path.join(this.root, 'projects.json'), { version: 1, projects })
    }
    async projects(): Promise<string[]> {
        const data = await readJson(path.join(this.root, 'projects.json'), { version: 1, projects: [] })
        if (data.version !== 1 || !Array.isArray(data.projects) || data.projects.some((p: unknown) => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('Invalid known-project reference index. Cleanup is disabled.')
        return data.projects
    }
    async references(entity: Pick<InstalledLibrary, 'libraryId' | 'repositoryUrl' | 'commit'>) {
        const projects: string[] = []
        const unavailable: string[] = []
        for (const project of await this.projects()) {
            try {
                if (!(await stat(project)).isDirectory()) throw new Error('Project directory is unavailable.')
                const directory = path.join(project, '.scad')
                if (await exists(path.join(directory, '.dependency-transaction'))) throw new Error('Project has an interrupted dependency transaction.')
                if (!(await exists(path.join(directory, 'dependencies.lock.json')))) {
                    const manifest = parseManifest(await readJson(path.join(directory, 'dependencies.json'), { manifestVersion: 1, dependencies: {} }))
                    const mounts = (await exists(path.join(directory, 'lib'))) ? await readdir(path.join(directory, 'lib')) : []
                    if (Object.keys(manifest.dependencies).length || mounts.length) throw new Error('Project has dependencies but no readable lockfile.')
                    continue
                }
                const lock = parseLockfile(await readJson(path.join(directory, 'dependencies.lock.json')))
                const dep = lock.dependencies[entity.libraryId]
                if (dep && repository(dep.source.repositoryUrl).url.toLowerCase() === repository(entity.repositoryUrl).url.toLowerCase() && dep.resolved.commit.toLowerCase() === entity.commit.toLowerCase()) projects.push(project)
            } catch {
                unavailable.push(project)
            }
        }
        return { projects, unavailable, externalReferencesUnknown: true as const }
    }
}
