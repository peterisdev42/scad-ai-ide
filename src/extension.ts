import { registerOwnedMarkdownPreview } from './features/markdown/OwnedMarkdownPreview'
import { notifications } from './platform/notifications'
import { registerGitHub } from './features/github/registerGitHub'
import * as vscode from 'vscode'
import { registerPreview } from './features/preview/registerPreview'
import { RuntimeManager } from './core/runtime/RuntimeManager'
import { CustomizerService } from './core/customizer/CustomizerService'
import { discover } from './platform/runtime/discovery'
import { registerRuntime } from './features/runtime/registerRuntime'
import { CustomizerViewProvider } from './features/sidebar/CustomizerViewProvider'
import { QuickAccessTreeProvider, quickAccess } from './features/sidebar/QuickAccessTreeProvider'
import { PanelManager } from './features/panels/PanelManager'
import { registerLanguage } from './features/language/registerLanguage'
import { registerMarkdown } from './features/markdown/registerMarkdown'

let language: ReturnType<typeof registerLanguage> | undefined

export async function activate(context: vscode.ExtensionContext) {
    notifications.reset()
    context.subscriptions.push(notifications)
    language = registerLanguage(context)
    const github = registerGitHub(context)
    const runtime = registerRuntime(context, new RuntimeManager(discover), github.request)
    const customizer = new CustomizerService()
    const preview = registerPreview(context, runtime, customizer)
    registerOwnedMarkdownPreview(context, runtime)
    const { ready: markdownReady, ...markdown } = registerMarkdown(context, runtime)
    const customizerView = new CustomizerViewProvider(customizer, context.extensionUri)
    const panels = new PanelManager(context.extensionUri, runtime, github)
    context.subscriptions.push(
        customizerView,
        ...(['resetAll', 'collapseAll', 'expandAll'] as const).map((action) => vscode.commands.registerCommand(`scad-ai-ide.customizer.${action}`, () => customizerView.runAction(action))),
        panels,
        vscode.commands.registerCommand('scad-ai-ide.connectGitHub', async () => {
            await github.connect()
            await runtime.loadBuilds(true)
        }),
        vscode.window.registerWebviewViewProvider('scad-ai.customizer', customizerView),
        vscode.window.createTreeView('scad-ai.quickAccess', { treeDataProvider: new QuickAccessTreeProvider() }),
        ...quickAccess.map((page) => vscode.commands.registerCommand(page.command, (tab?: unknown) => panels.open(page.id, tab === 'available' ? 'available' : undefined))),
    )
    // Markdown's plugin hook is synchronous. Make its grammar ready before VS Code
    // obtains the hook, instead of relying on a refresh racing the first webview load.
    await markdownReady
    return { ...markdown, preview, language, getActiveRuntime: runtime.getActiveRuntime, refresh: runtime.refresh, customizer, panels, getRenderArguments: () => customizer.getArguments() }
}

export async function deactivate() {
    await language?.stop()
    language = undefined
}
