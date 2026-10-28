import { registerGitHub } from './features/github/registerGitHub'
import * as vscode from 'vscode'
import { registerPreview } from './features/preview/registerPreview'
import { RuntimeManager } from './core/runtime/RuntimeManager'
import { CustomizerService } from './core/customizer/CustomizerService'
import { discover } from './platform/runtime/discovery'
import { registerRuntime } from './features/runtime/registerRuntime'
import { CustomizerTreeProvider } from './features/sidebar/CustomizerTreeProvider'
import { QuickAccessTreeProvider, quickAccess } from './features/sidebar/QuickAccessTreeProvider'
import { PanelManager } from './features/panels/PanelManager'
import { registerLanguage } from './features/language/registerLanguage'

let language: ReturnType<typeof registerLanguage> | undefined

export function activate(context: vscode.ExtensionContext) {
    language = registerLanguage(context)
    const github = registerGitHub(context)
    const runtime = registerRuntime(context, new RuntimeManager(discover), github.request)
    const customizer = new CustomizerService()
    const preview = registerPreview(context, runtime, customizer)
    const customizerTree = new CustomizerTreeProvider(customizer)
    const panels = new PanelManager(context.extensionUri, runtime, github)
    context.subscriptions.push(
        customizerTree,
        panels,
        vscode.commands.registerCommand('scad-ai-ide.connectGitHub', async () => {
            await github.connect()
            await runtime.loadBuilds(true)
        }),
        vscode.window.createTreeView('scad-ai.customizer', { treeDataProvider: customizerTree }),
        vscode.window.createTreeView('scad-ai.quickAccess', { treeDataProvider: new QuickAccessTreeProvider() }),
        vscode.commands.registerCommand('scad-ai.customizer.edit', (target: string, name: string) => customizerTree.edit(target, name)),
        ...quickAccess.map((page) => vscode.commands.registerCommand(page.command, (tab?: unknown) => panels.open(page.id, tab === 'available' ? 'available' : undefined))),
    )
    return { preview, language, getActiveRuntime: runtime.getActiveRuntime, refresh: runtime.refresh, customizer, panels, getRenderArguments: () => customizer.getArguments() }
}

export async function deactivate() {
    await language?.stop()
    language = undefined
}
