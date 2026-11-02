import { join } from 'node:path'
import { commands, ConfigurationTarget, ProgressLocation, window, workspace, type ExtensionContext } from 'vscode'
import { configureExporterResolver, discoverExporters, installExporter, managedExporterPath, probeExporter, assertExporterPlatform } from '../../../../platform/previewExporter/runtime'
let storageRoot = ''
export async function resolvePreviewExporter(): Promise<string> {
    assertExporterPlatform()
    const configured = workspace.getConfiguration('scad-ai-ide.preview').get<string>('exporterPath', '')
    if (configured) return (await probeExporter(configured)).executable
    const found = await discoverExporters(storageRoot)
    if (!found.length) throw new Error('Preview Exporter is not installed. Run “SCAD AI IDE: Install Preview Exporter”, or select Full Render.')
    return found[0].executable
}
export function registerPreviewExporter(context: ExtensionContext) {
    storageRoot = context.globalStorageUri.fsPath
    configureExporterResolver(resolvePreviewExporter)
    context.subscriptions.push(
        commands.registerCommand('scad-ai-ide.installPreviewExporter', async () => {
            if (!workspace.isTrusted) throw new Error('Trust this workspace to install Preview Exporter.')
            await window.withProgress({ location: ProgressLocation.Notification, title: 'Installing Preview Exporter', cancellable: true }, async (_p, token) => {
                const controller = new AbortController(),
                    sub = token.onCancellationRequested(() => controller.abort())
                try {
                    const installed = await installExporter(storageRoot, controller.signal)
                    await workspace.getConfiguration('scad-ai-ide.preview').update('exporterPath', installed.executable, ConfigurationTarget.Global)
                } finally {
                    sub.dispose()
                }
            })
        }),
        commands.registerCommand('scad-ai-ide.selectPreviewExporter', async () => {
            assertExporterPlatform()
            const found = await discoverExporters(storageRoot),
                selection = await window.showQuickPick([...found.map((e) => ({ label: e.executable, description: `${e.tag} · Schema ${e.schemaVersion}` })), { label: 'Browse…', description: 'Select bin/openscad-preview-exporter' }], { title: 'Select independent Preview Exporter' })
            if (!selection) return
            let executable = selection.label
            if (executable === 'Browse…') {
                const files = await window.showOpenDialog({ canSelectMany: false, defaultUri: context.globalStorageUri.with({ path: join(context.globalStorageUri.path, 'preview-exporter') }) })
                if (!files?.[0]) return
                executable = files[0].fsPath
            }
            await probeExporter(executable)
            await workspace.getConfiguration('scad-ai-ide.preview').update('exporterPath', executable, ConfigurationTarget.Global)
        }),
    )
}
