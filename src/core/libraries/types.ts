export interface Layout {
    includeName: string
    includeRoot: string
}
export interface RegistryVersion {
    kind: 'tag' | 'snapshot'
    tag: string | null
    commit: string
    downloadUrl: string
    prerelease: boolean | null
    layout?: Layout
}
export interface RegistryLibrary {
    validationError?: string
    id: string
    name: string
    description: string
    repositoryUrl: string
    documentationUrl: string
    license: string
    versions: RegistryVersion[]
    latestVersion: string | null
    sync: { status: 'ok' | 'stale' | 'error' }
    layout?: Layout
}
export interface Registry {
    schemaVersion: 1 | 2
    generatedAt: string
    libraries: RegistryLibrary[]
}
export interface LockedDependency {
    source: { provider: 'github' | 'codeberg'; repositoryUrl: string }
    resolved: { kind: 'tag' | 'snapshot'; tag: string | null; commit: string }
    mount: { name: string; includeRoot: string }
}
export interface Manifest {
    manifestVersion: 1
    dependencies: Record<string, { version: string }>
}
export interface Lockfile {
    lockVersion: 1
    dependencies: Record<string, LockedDependency>
}
export interface InstalledLibrary {
    libraryId: string
    repositoryUrl: string
    commit: string
    versions: string[]
    sourcePath: string
    installedAt: string
    sizeBytes: number
    integrity: 'verified' | 'unknown'
    files: Record<string, string>
}
export type LinkMode = 'symlink' | 'junction' | 'copy'
export const versionLabel = (v: { kind: string; tag: string | null; commit: string }) => (v.kind === 'tag' ? v.tag! : `snapshot:${v.commit}`)
