import { stat } from 'node:fs/promises'
import * as vscode from 'vscode'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { notifications } from '../../platform/notifications'
import { assertWorkspacePath } from '../../platform/WorkspacePaths'
import { previewEditorViewType } from './extension/services/previewFile'

export const previewLinkPath = '/open-model-preview'

async function validateModelUri(uri: vscode.Uri): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Trust the workspace to open model previews.')
    if (uri.scheme !== 'file' || !/\.scad$/i.test(uri.path)) {
        throw new CapabilityError('INVALID_URI', 'Supply a workspace .scad file URI.')
    }
    try {
        await assertWorkspacePath(uri)
        if (!(await stat(uri.fsPath)).isFile()) throw new CapabilityError('INVALID_PATH', 'Choose a .scad file in the workspace.')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CapabilityError('FILE_NOT_FOUND', 'The .scad file no longer exists.')
        throw error
    }
}

export function createPreviewLinks(extensionId: string) {
    return {
        async create(value: string) {
            let uri: vscode.Uri
            try {
                uri = vscode.Uri.parse(value, true)
            } catch {
                throw new CapabilityError('INVALID_URI', 'Supply a workspace .scad file URI.')
            }
            await validateModelUri(uri)
            const href = vscode.Uri.from({
                scheme: vscode.env.uriScheme,
                authority: extensionId,
                path: previewLinkPath + uri.path,
            }).toString()
            return { uri: uri.toString(), markdownLink: `[View model preview](${href})` }
        },
        async open(link: vscode.Uri) {
            try {
                const uri = link.with({ scheme: 'file', authority: '', path: link.path.slice(previewLinkPath.length) })
                await validateModelUri(uri)
                await vscode.commands.executeCommand('vscode.openWith', uri, previewEditorViewType, { preview: false })
            } catch (error) {
                void notifications.previewError(error, link.path)
            }
        },
    }
}
