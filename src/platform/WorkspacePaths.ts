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
