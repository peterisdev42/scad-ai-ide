import { memoryCaches } from '../../core/cache/CacheRegistry'
import * as vscode from 'vscode'
import * as path from 'node:path'
import { GlobalLibraryStore, inventory } from '../../platform/libraries/GlobalLibraryStore'
import { RegistryClient } from '../../platform/libraries/RegistryClient'
import { LibraryInstaller } from '../../platform/libraries/LibraryInstaller'
import { LibraryLinker } from '../../platform/libraries/LibraryLinker'
import { ProjectDependencyManager } from '../../platform/libraries/ProjectDependencyManager'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { confirmLibraryCopy } from '../../platform/notifications'
import { LibraryPanelController } from './LibraryPanelController'
export function registerLibraries(context: vscode.ExtensionContext) {
    libraryEnvironment.configure(() => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath))
    const store = new GlobalLibraryStore(context.globalStorageUri.fsPath)
    const registry = new RegistryClient(store.root, fetch, undefined, context.globalState)
    const manager = new ProjectDependencyManager(store, registry, new LibraryInstaller(store), new LibraryLinker(async (source) => confirmLibraryCopy(source, (await inventory(source)).sizeBytes)), (root) => libraryEnvironment.notifyChanged(root))
    const controller = new LibraryPanelController(manager)
    const watcher = vscode.workspace.createFileSystemWatcher('**/.scad/{dependencies.json,dependencies.lock.json,mounts.json,lib/*}')
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (uri: vscode.Uri) => {
        const parts = uri.fsPath.split(path.sep)
        const index = parts.lastIndexOf('.scad')
        if (index < 0) return
        pending.add(parts.slice(0, index).join(path.sep))
        clearTimeout(timer)
        timer = setTimeout(() => {
            for (const root of pending) libraryEnvironment.notifyChanged(root)
            pending.clear()
        }, 150)
    }
    const registerProjects = () => {
        if (!vscode.workspace.isTrusted) return
        void store
            .exclusive(async () => {
                for (const project of await controller.projects()) await manager.references.register(project)
            })
            .catch((error) => console.error('Library project index:', error))
    }
    context.subscriptions.push(memoryCaches.register('Library Registry catalog', () => registry.cacheInfo(), () => controller.clearRegistryCache()), controller, watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed), vscode.workspace.onDidChangeWorkspaceFolders(registerProjects), vscode.workspace.onDidGrantWorkspaceTrust(registerProjects), { dispose: () => clearTimeout(timer) })
    registerProjects()
    return controller
}
