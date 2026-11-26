import { join } from 'node:path'
import { commands, ConfigurationTarget, window, workspace, type ExtensionContext } from 'vscode'
import { configureExporterResolver, discoverExporters, probeExporter, assertExporterPlatform, PreviewExporterUnavailableError } from '../../../../platform/previewExporter/runtime'
let storageRoot = ''
export async function resolvePreviewExporter(): Promise<string> {
    try {
        assertExporterPlatform()
        const configured = workspace.getConfiguration('scad-ai-ide.preview').get<string>('exporterPath', '')
        if (configured) return (await probeExporter(configured)).executable
        const found = await discoverExporters(storageRoot)
        if (found.length) return found[0].executable
    } catch (cause) {
        throw new PreviewExporterUnavailableError('Fast CSG requires a compatible local Preview Exporter. Using Full Render.', { cause })
    }
    throw new PreviewExporterUnavailableError('Fast CSG requires a compatible local Preview Exporter. Using Full Render.')
}
export function registerPreviewExporter(context: ExtensionContext) {
    storageRoot = context.globalStorageUri.fsPath
    configureExporterResolver(resolvePreviewExporter)
    context.subscriptions.push(
        commands.registerCommand('scad-ai-ide.selectPreviewExporter', async () => {
            if (!workspace.isTrusted) throw new Error('Trust this workspace to select and run Preview Exporter.')
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
