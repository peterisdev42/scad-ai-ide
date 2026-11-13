import { notifications } from '../../platform/notifications'
import { MeshArtifactProvider } from './MeshArtifactProvider'
import { MeshWorkspaceService } from './MeshWorkspaceService'
import * as vscode from 'vscode'
import type { CustomizerService } from '../../core/customizer/CustomizerService'
import { cadExecution } from '../../platform/openscad/CadExecutionService'
import { ScadClient } from '../preview/extension/services/ScadClient'
import { PreviewSourceProblems } from '../preview/extension/services/PreviewSourceProblems'
import type { registerRuntime } from '../runtime/registerRuntime'
import { CadWorkspaceService } from './CadWorkspaceService'

export function registerCadVerification(context: vscode.ExtensionContext, runtime: ReturnType<typeof registerRuntime>, customizer: CustomizerService) {
    const problems = new PreviewSourceProblems()
    const service = new CadWorkspaceService(runtime, customizer, problems)
    const geometry = new MeshWorkspaceService(context, service, runtime)
    service.geometry = geometry
    context.subscriptions.push(geometry)
    const output = vscode.window.createOutputChannel('SCAD AI IDE CAD')
    ScadClient.configure(
        async () => {
            await runtime.whenReady()
            const selected = runtime.getActiveRuntime()
            if (!selected) throw new Error('Select an OpenSCAD Runtime.')
            return selected.command
        },
        (request) => service.preparePreview(request),
    )
    context.subscriptions.push(
        problems,
        vscode.workspace.registerFileSystemProvider('scad-cad-artifact', new MeshArtifactProvider(geometry), { isReadonly: true, isCaseSensitive: true }),
        problems.registerNavigation(),
        service,
        output,
        ScadClient.outputChannel,
        {
            dispose: () => {
                ScadClient.dispose()
                cadExecution.dispose()
            },
        },
        vscode.workspace.registerTextDocumentContentProvider('scad-cad-report', { onDidChange: service.onDidChangeReports, provideTextDocumentContent: (uri) => service.reportText(uri.path.slice(1)) }),
        vscode.commands.registerCommand('scad-ai-ide.model.analyze', async (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri
            if (!target) throw new Error('Choose an OpenSCAD document to analyze.')
            const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Analyze OpenSCAD diagnostics', cancellable: true }, async (_progress, token) => {
                const abort = new AbortController(),
                    subscription = token.onCancellationRequested(() => abort.abort())
                try {
                    return await service.analyze({ uri: target.toString() }, abort.signal)
                } finally {
                    subscription.dispose()
                }
            })
            await vscode.commands.executeCommand('scad-ai-ide.model.openReport', report.reportId)
            return report
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.verify', async (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri
            if (!target) throw new Error('Choose a workspace SCAD/CSG/STL/3MF document.')
            const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Verify raw CAD mesh', cancellable: true }, async (_, token) => {
                const abort = new AbortController(),
                    sub = token.onCancellationRequested(() => abort.abort())
                try {
                    return await geometry.verify({ uri: target.toString() }, abort.signal)
                } finally {
                    sub.dispose()
                }
            })
            await vscode.commands.executeCommand('scad-ai-ide.model.openReport', report.reportId)
            return report
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.measure', async (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri
            if (!target) throw new Error('Choose a workspace CAD document.')
            const result = await geometry.measure({ uri: target.toString() })
            await vscode.commands.executeCommand('scad-ai-ide.model.openReport', result.reportId)
            return result
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.renderViews', async (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri
            if (!target) throw new Error('Choose a workspace CAD document.')
            const result = await geometry.renderViews({ uri: target.toString() })
            if (result.frames.length) await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(result.frames[0].artifactUri))
            else notifications.geometryImagesUnavailable(result.message ?? result.reasonCode ?? result.renderStatus, target.toString())
            return result
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.openReport', async (id: unknown) => {
            if (typeof id !== 'string' || !/^cad-[a-f0-9-]{36}$/.test(id)) throw new Error('Choose a current CAD report ID.')
            const document = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: 'scad-cad-report', path: `/${id}` }))
            await vscode.window.showTextDocument(document, { preview: false })
        }),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.uri.scheme !== 'file' || !/\.(scad|csg)$/i.test(document.uri.path) || !vscode.workspace.getWorkspaceFolder(document.uri)) return
            if (vscode.workspace.getConfiguration('scad-ai-ide.verification', document.uri).get<string>('onSave', 'off') !== 'diagnostics' || !service.availability().enabled) return
            void service.analyze({ uri: document.uri.toString() }).catch((error) => output.appendLine(error instanceof Error ? error.message : String(error)))
        }),
    )
    return service
}
