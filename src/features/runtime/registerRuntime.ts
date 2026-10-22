import * as vscode from 'vscode'
import { fileCandidate, probe, type Runtime, type LaunchCommand } from '../../platform/runtime/discovery'
import { resolveApplication } from '../../platform/runtime/platformDiscovery'
import { RuntimeManager } from '../../core/runtime/RuntimeManager'

const section = 'scad-ai-ide'

export function registerRuntime(context: vscode.ExtensionContext, manager: RuntimeManager) {
    const output = vscode.window.createOutputChannel('SCAD AI IDE Runtime')
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20)
    status.command = 'scad-ai-ide.selectRuntime'
    status.name = 'OpenSCAD Runtime'
    status.show()
    const changed = new vscode.EventEmitter<void>()
    let busy = false
    let message = ''
    let saving = false
    let generation = 0
    let disposed = false
    let pending: Promise<void> = Promise.resolve()

    const refresh = () => {
        const current = ++generation
        status.text = 'OpenSCAD: Discovering'
        busy = true
        changed.fire()
        pending = pending
            .then(async () => {
                if (disposed || current !== generation) {
                    return
                }
                if (!vscode.workspace.isTrusted) {
                    manager.clear()
                    status.text = 'OpenSCAD: Restricted'
                    status.tooltip = 'Trust this workspace to discover and execute OpenSCAD'
                    message = 'Workspace trust required to discover OpenSCAD'
                    return
                }
                const configuration = vscode.workspace.getConfiguration(section)
                const configuredPath = configuration.get<string>('openscadPath', '')
                const configuredCommand = configuration.get<LaunchCommand | null>('runtimeCommand') ?? undefined
                const bundledPath = vscode.Uri.joinPath(context.globalStorageUri, 'runtimes', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'openscad.com' : 'openscad').fsPath
                await manager.refresh({
                    configuredPath,
                    configuredCommand,
                    bundledPath,
                })
                if (disposed || current !== generation) {
                    return
                }
                const { result, active } = manager
                message = result.configuredError ?? (active ? '' : 'No OpenSCAD runtime found')
                output.appendLine(`\n[${new Date().toISOString()}] OpenSCAD discovery on ${process.platform}`)
                result.diagnostics.forEach((line) => output.appendLine(line))
                status.text = active ? `OpenSCAD ${active.version}` : 'OpenSCAD: Setup'
                status.tooltip = active ? active.command.executable : (result.configuredError ?? 'OpenSCAD not found. Click to select an executable.')
            })
            .catch((error) => {
                output.appendLine(String(error))
                if (!disposed && current === generation) {
                    manager.clear()
                    status.text = 'OpenSCAD: Detection failed'
                    message = 'Detection failed. See Runtime output.'
                }
            })
            .finally(() => {
                if (!disposed && current === generation) {
                    busy = false
                    changed.fire()
                }
            })
        return pending
    }

    const saveCommand = async (command: LaunchCommand | null) => {
        const configuration = vscode.workspace.getConfiguration(section)
        const current = configuration.get<LaunchCommand | null>('runtimeCommand')
        if (!configuration.get<string>('openscadPath') && current?.executable === command?.executable && JSON.stringify(current?.argsPrefix) === JSON.stringify(command?.argsPrefix)) {
            return
        }
        saving = true
        try {
            await configuration.update('openscadPath', '', vscode.ConfigurationTarget.Global)
            await configuration.update('runtimeCommand', command, vscode.ConfigurationTarget.Global)
        } finally {
            saving = false
        }
        await refresh()
    }

    const browse = async () => {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showInformationMessage('Trust this workspace before adding an OpenSCAD runtime.')
            return
        }
        const files = await vscode.window.showOpenDialog({
            title: 'Select OpenSCAD executable (or macOS .app)',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Use OpenSCAD',
        })
        if (!files?.[0]) {
            return
        }
        const file = files[0].fsPath
        try {
            const candidate = process.platform === 'darwin' ? await resolveApplication(fileCandidate(file, 'custom')) : fileCandidate(file, 'custom')
            await probe(candidate)
            await saveCommand(candidate.command)
        } catch (error) {
            void vscode.window.showErrorMessage(`Cannot use OpenSCAD: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    const select = async (requestedId?: string) => {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showInformationMessage('Trust this workspace before discovering or running OpenSCAD.')
            return
        }
        await pending
        const requested = manager.result.runtimes.find((runtime) => runtime.id === requestedId)
        if (requested) {
            await saveCommand(requested.command)
            return
        }
        const choices: (vscode.QuickPickItem & {
            runtime?: Runtime
            action?: string
        })[] = manager.result.runtimes.map((runtime) => ({
            label: `OpenSCAD ${runtime.version}`,
            description: runtime.command.executable,
            runtime,
        }))
        choices.push({ label: 'Browse for OpenSCAD…', action: 'browse' }, { label: 'Use automatic discovery', action: 'auto' })
        const choice = await vscode.window.showQuickPick(choices, {
            title: 'OpenSCAD Runtime',
            matchOnDescription: true,
        })
        if (choice?.runtime) {
            await saveCommand(choice.runtime.command)
        } else if (choice?.action === 'browse') {
            await browse()
        } else if (choice?.action === 'auto') {
            await saveCommand(null)
        }
    }

    context.subscriptions.push(
        output,
        status,
        changed,
        {
            dispose: () => {
                disposed = true
                generation++
            },
        },
        vscode.commands.registerCommand('scad-ai-ide.refreshRuntimes', refresh),
        vscode.commands.registerCommand('scad-ai-ide.selectRuntime', select),
        vscode.commands.registerCommand('scad-ai-ide.addRuntime', browse),
        vscode.commands.registerCommand('scad-ai-ide.showRuntimeOutput', () => output.show()),
        vscode.workspace.onDidGrantWorkspaceTrust(refresh),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!saving && (event.affectsConfiguration(`${section}.openscadPath`) || event.affectsConfiguration(`${section}.runtimeCommand`))) {
                void refresh()
            }
        }),
    )
    void refresh()
    return {
        getActiveRuntime: () => manager.active,
        whenReady: () => pending,
        getState: () => ({ runtimes: manager.result.runtimes, activeId: manager.active?.id, busy, message }),
        onDidChange: changed.event,
        refresh,
        browse,
        select,
        automatic: () => saveCommand(null),
        showDiagnostics: () => output.show(),
    }
}
