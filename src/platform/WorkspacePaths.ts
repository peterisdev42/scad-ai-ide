import * as vscode from 'vscode'
import * as path from 'node:path'
import { realpath, lstat } from 'node:fs/promises'
import { CapabilityError } from '../core/capabilities/CapabilityTypes'

/** Validate on the workspace extension host, including canonical parents for new files. */
export async function assertWorkspacePath(uri: vscode.Uri, allowMissing = false) {
    if (uri.scheme !== 'file' || uri.query || uri.fragment || uri.authority) throw new CapabilityError('INVALID_PATH', 'Use a local file URI on the extension host.')
    let canonical: string
    try {
        if ((await lstat(uri.fsPath)).isSymbolicLink()) throw new CapabilityError('INVALID_PATH', 'Symbolic-link targets are not allowed.')
        canonical = await realpath(uri.fsPath)
    } catch (error) {
        if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        canonical = path.join(await realpath(path.dirname(uri.fsPath)), path.basename(uri.fsPath))
    }
    const roots = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file')
    for (const root of roots) {
        const relative = path.relative(await realpath(root.uri.fsPath), canonical)
        if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) return
    }
    throw new CapabilityError('INVALID_PROJECT', 'Target is outside the workspace. Choose a workspace file on the extension host.')
}

/** VS Code folder lookup is lexical; local canonical aliases (for example
 * macOS /var and /private/var) still belong to the same guarded workspace. */
export async function workspaceFolderForUri(uri: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
    const direct = vscode.workspace.getWorkspaceFolder(uri)
    if (direct) return direct
    if (uri.scheme !== 'file') return undefined
    const canonical = await realpath(uri.fsPath).catch(() => path.resolve(uri.fsPath))
    for (const folder of [...(vscode.workspace.workspaceFolders ?? [])].sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)) {
        if (folder.uri.scheme !== 'file') continue
        const root = await realpath(folder.uri.fsPath),
            relative = path.relative(root, canonical)
        if (relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) return folder
    }
    return undefined
}
