import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { UserWarning } from '../../core/feedback'
import * as vscode from 'vscode'
import { createRuntimeService } from './RuntimeService'
import type { RuntimeManager } from '../../core/runtime/RuntimeManager'
import type { GitHubRequest } from '../../platform/github/client'

/** Input gathering only. All callers share the service instance and its mutation gate. */
export function registerRuntime(context: vscode.ExtensionContext, manager: RuntimeManager, request: GitHubRequest) {
    const output = vscode.window.createOutputChannel('SCAD AI IDE Runtime')
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20)
    status.command = 'scad-ai-ide.selectRuntime'
    status.name = 'OpenSCAD Runtime'
    status.show()
    context.subscriptions.push(output, status)
    const service = createRuntimeService(context, manager, request, { output, status, withProgress: vscode.window.withProgress })
    const gui = async (task: () => Promise<void>) => {
        try { await task() } catch (error) {
            if (!(error instanceof CapabilityError) || !['BUSY', 'CANCELLED'].includes(error.code)) throw error
        }
    }
    const assertTrusted = () => { if (!vscode.workspace.isTrusted) throw new UserWarning('Trust this workspace to discover, add, or run OpenSCAD runtimes.') }
    const browse = async () => {
        assertTrusted()
        const files = await vscode.window.showOpenDialog({ title: 'Select OpenSCAD executable (or macOS .app)', canSelectMany: false, openLabel: 'Use OpenSCAD' })
        if (files?.[0]) await service.addExecutable(files[0].fsPath)
    }
    const installArchive = async () => {
        assertTrusted()
        const files = await vscode.window.showOpenDialog({ title: 'Install OpenSCAD CLI from Archive', canSelectMany: false, filters: { 'OpenSCAD CLI archives': ['zip', 'gz'] }, openLabel: 'Install Runtime' })
        if (files?.[0]) await gui(() => service.installArchivePath(files[0].fsPath))
    }
    const select = async (id?: string) => {
        assertTrusted()
        if (id) return gui(() => service.select(id))
        await service.whenReady()
        const choices = service.getState().runtimes.map((runtime) => ({ label: `OpenSCAD ${runtime.version}`, description: runtime.command.executable, id: runtime.id }))
        choices.push({ label: 'Download Other OpenSCAD CLI Versions…', description: '', id: '' })
        const choice = await vscode.window.showQuickPick(choices, { title: 'OpenSCAD Runtime', matchOnDescription: true })
        if (choice?.id) await service.select(choice.id)
        else if (choice) await vscode.commands.executeCommand('scad-ai.runtime.open', 'available')
    }
    context.subscriptions.push(
        vscode.commands.registerCommand('scad-ai-ide.refreshRuntimes', service.refresh),
        vscode.commands.registerCommand('scad-ai-ide.selectRuntime', select),
        vscode.commands.registerCommand('scad-ai-ide.addRuntime', browse),
        vscode.commands.registerCommand('scad-ai-ide.installRuntimeArchive', installArchive),
    )
    return { ...service, service, browse, installArchive, select }
}
