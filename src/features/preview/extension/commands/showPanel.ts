import { commands, Disposable, TabInputCustom, TabInputText, window } from 'vscode'
import { isPreviewEditor, meshFormat, meshPreviewEditorViewType, previewEditorViewType } from '../services/previewFile'
export { previewEditorViewType } from '../services/previewFile'

/** Use the same editor replacement command as the built-in Markdown preview. */
export function registerShowPanelCommand(): Disposable {
    return Disposable.from(
        commands.registerCommand('scad-ai-ide.showPreview', async () => {
            const input = window.tabGroups.activeTabGroup.activeTab?.input
            const document = window.activeTextEditor?.document
            // A binary editor has a tab URI but no active TextEditor.
            const uri = input instanceof TabInputText || input instanceof TabInputCustom ? input.uri : document?.uri
            if (uri?.scheme !== 'file') return
            const format = meshFormat(uri.path)
            if (!format && !/\.(scad|csg)$/i.test(uri.path) && document?.languageId !== 'openscad') return
            await commands.executeCommand('reopenActiveEditorWith', format ? meshPreviewEditorViewType : previewEditorViewType)
        }),
        commands.registerCommand('scad-ai-ide.showSource', async () => {
            const input = window.tabGroups.activeTabGroup.activeTab?.input
            if (!(input instanceof TabInputCustom) || !isPreviewEditor(input.viewType)) return
            await commands.executeCommand('reopenActiveEditorWith', 'default')
        }),
        commands.registerCommand('scad-ai-ide.togglePreview', async () => {
            const input = window.tabGroups.activeTabGroup.activeTab?.input
            await commands.executeCommand(input instanceof TabInputCustom && isPreviewEditor(input.viewType) ? 'scad-ai-ide.showSource' : 'scad-ai-ide.showPreview')
        }),
    )
}
