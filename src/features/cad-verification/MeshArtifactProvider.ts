import * as vscode from 'vscode'
import type { MeshWorkspaceService } from './MeshWorkspaceService'
/** Session-scoped readonly PNGs. IDs resolve only to renderer-owned artifacts. */
export class MeshArtifactProvider implements vscode.FileSystemProvider {
    private readonly events = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    readonly onDidChangeFile = this.events.event
    constructor(private readonly mesh: MeshWorkspaceService) {}
    private id(uri: vscode.Uri) {
        if (uri.authority || uri.query || uri.fragment || !/^\/[a-f0-9]{64}\.png$/.test(uri.path)) throw vscode.FileSystemError.FileNotFound(uri)
        return uri.path.slice(1, -4)
    }
    async readFile(uri: vscode.Uri) {
        try {
            return await this.mesh.readImage(this.id(uri))
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri)
        }
    }
    async stat(uri: vscode.Uri) {
        const data = await this.readFile(uri)
        return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: data.byteLength, permissions: vscode.FilePermission.Readonly }
    }
    watch() {
        return new vscode.Disposable(() => {})
    }
    readDirectory() {
        return []
    }
    createDirectory() {
        throw vscode.FileSystemError.NoPermissions('Readonly CAD artifact')
    }
    writeFile() {
        throw vscode.FileSystemError.NoPermissions('Readonly CAD artifact')
    }
    delete() {
        throw vscode.FileSystemError.NoPermissions('Readonly CAD artifact')
    }
    rename() {
        throw vscode.FileSystemError.NoPermissions('Readonly CAD artifact')
    }
    dispose() {
        this.events.dispose()
    }
}
