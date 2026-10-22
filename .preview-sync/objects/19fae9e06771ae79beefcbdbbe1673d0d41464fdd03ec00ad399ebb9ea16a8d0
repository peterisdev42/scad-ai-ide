import { commands, Disposable, TabInputCustom, window } from 'vscode'

export const previewEditorViewType = 'scad-ai-ide.preview.editor'

/** Use the same editor replacement command as the built-in Markdown preview. */
export function registerShowPanelCommand(): Disposable {
    return Disposable.from(
        commands.registerCommand('scad-ai-ide.showPreview', async () => {
            const document = window.activeTextEditor?.document
            if (document?.languageId !== 'openscad' || document.uri.scheme !== 'file') return
            await commands.executeCommand('reopenActiveEditorWith', previewEditorViewType)
        }),
        commands.registerCommand('scad-ai-ide.showSource', async () => {
            const input = window.tabGroups.activeTabGroup.activeTab?.input
            if (!(input instanceof TabInputCustom) || input.viewType !== previewEditorViewType) return
            await commands.executeCommand('reopenActiveEditorWith', 'default')
        }),
        commands.registerCommand('scad-ai-ide.togglePreview', async () => {
            const input = window.tabGroups.activeTabGroup.activeTab?.input
            await commands.executeCommand(input instanceof TabInputCustom && input.viewType === previewEditorViewType ? 'scad-ai-ide.showSource' : 'scad-ai-ide.showPreview')
        }),
    )
}
