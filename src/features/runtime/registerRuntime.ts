import type { GitHubRequest } from '../../platform/github/client'
import * as vscode from 'vscode'
import { fileCandidate, probe, type Runtime, type LaunchCommand } from '../../platform/runtime/discovery'
import { resolveApplication } from '../../platform/runtime/platformDiscovery'
import { RuntimeManager } from '../../core/runtime/RuntimeManager'
import { sortRuntimesByVersion } from '../../core/runtime/sortRuntimes'
import { UserWarning } from '../../core/feedback'
import { detectRuntimeSystem, fetchRuntimeBuilds, type RuntimeBuild, type RuntimeSystem } from '../../platform/runtime/releases'
import { installRuntimeArchive, installRuntimeBuild, removeRuntimeInstallation, installedRuntimeBuilds, managedRuntimePaths, type InstalledRuntimeBuild, type InstallProgress, type InstallOptions } from '../../platform/runtime/installation'
import * as path from 'node:path'
import { notifications } from '../../platform/notifications'

const section = 'scad-ai-ide'
const workspaceTrustMessage = 'Trust this workspace to discover, add, or run OpenSCAD runtimes.'

export function registerRuntime(context: vscode.ExtensionContext, manager: RuntimeManager, request: GitHubRequest) {
    const output = vscode.window.createOutputChannel('SCAD AI IDE Runtime')
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20)
    status.command = 'scad-ai-ide.selectRuntime'
    status.name = 'OpenSCAD Runtime'
    status.show()
    const changed = new vscode.EventEmitter<void>()
    let busy = false
    let discovered = false
    let refreshingSilently = false
    let deletingId: string | undefined
    let selectingId: string | undefined
    let message = ''
    let saving = false
    let generation = 0
    let disposed = false
    let pending: Promise<void> = Promise.resolve()
    let system: RuntimeSystem | undefined
    let builds: RuntimeBuild[] = []
    let installedBuilds: InstalledRuntimeBuild[] = []
    let buildsBusy = false
    let buildsError = ''
    let buildsLoaded = false
    let buildsPending: Promise<void> | undefined
    let installing: InstallProgress | undefined
    let installationMessage = ''
    let installationError = ''
    let installationIsArchive = false
    let installationAbort: AbortController | undefined
    const runtimesRoot = vscode.Uri.joinPath(context.globalStorageUri, 'runtimes').fsPath

    const loadBuilds = (force = false): Promise<void> => {
        if (buildsPending) {
            // A newly authorized account must refresh even if an anonymous request
            // was already running when the user connected GitHub.
            return force ? buildsPending.then(() => loadBuilds(true)) : buildsPending
        }
        if (buildsLoaded && !force) {
            return (async () => {
                installedBuilds = await installedRuntimeBuilds(runtimesRoot, system!, builds)
                if (!disposed) {
                    changed.fire()
                }
            })()
        }
        buildsBusy = true
        buildsError = ''
        changed.fire()
        buildsPending = (async () => {
            system ??= await detectRuntimeSystem()
            if (!disposed) {
                changed.fire()
            }
            builds = await fetchRuntimeBuilds(system, request)
            installedBuilds = await installedRuntimeBuilds(runtimesRoot, system, builds)
            buildsLoaded = true
        })()
            .catch((error) => {
                buildsError = error instanceof Error ? error.message : String(error)
                output.appendLine(`GitHub Releases: ${buildsError}`)
            })
            .finally(() => {
                buildsBusy = false
                buildsPending = undefined
                if (!disposed) {
                    changed.fire()
                }
            })
        return buildsPending
    }

    const discoveryState = () => JSON.stringify({ result: manager.result, activeId: manager.active?.id, message, installedBuilds })
    const refresh = (silent = false) => {
        const current = ++generation
        const before = discoveryState()
        refreshingSilently = silent && discovered
        busy = true
        if (!refreshingSilently) {
            status.text = 'OpenSCAD: Discovering'
            changed.fire()
        }
        pending = pending
            .then(async () => {
                if (disposed || current !== generation) {
                    return
                }
                if (!vscode.workspace.isTrusted) {
                    manager.clear()
                    installedBuilds = []
                    status.text = 'OpenSCAD: Restricted'
                    status.tooltip = 'Trust this workspace to discover and execute OpenSCAD'
                    message = workspaceTrustMessage
                    return
                }
                const configuration = vscode.workspace.getConfiguration(section)
                const configuredPath = configuration.get<string>('openscadPath', '')
                const configuredCommand = configuration.get<LaunchCommand | null>('runtimeCommand') ?? undefined
                const bundledPath = vscode.Uri.joinPath(context.globalStorageUri, 'runtimes', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'openscad.com' : 'openscad').fsPath
                system ??= await detectRuntimeSystem()
                await manager.refresh({
                    configuredPath,
                    configuredCommand,
                    bundledPath,
                    managedPaths: await managedRuntimePaths(runtimesRoot, system),
                })
                installedBuilds = await installedRuntimeBuilds(runtimesRoot, system, builds)
                if (disposed || current !== generation) {
                    return
                }
                const { result, active } = manager
                message = result.configuredError ?? (active ? '' : 'No OpenSCAD runtime found')
                output.appendLine(`\n[${new Date().toISOString()}] OpenSCAD discovery on ${process.platform}`)
                result.diagnostics.forEach((line) => output.appendLine(line))
                status.text = active ? `OpenSCAD ${active.version}` : 'OpenSCAD: Setup'
                status.tooltip = active ? active.command.executable : (result.configuredError ?? 'OpenSCAD not found. Click to select an executable.')
                if (active) {
                    notifications.runtimeAvailable()
                } else {
                    void notifications.runtimeUnavailable()
                }
            })
            .catch((error) => {
                output.appendLine(String(error))
                if (!disposed && current === generation) {
                    manager.clear()
                    installedBuilds = []
                    status.text = 'OpenSCAD: Detection failed'
                    message = `Detection failed: ${error instanceof Error ? error.message : String(error)}`
                }
            })
            .finally(() => {
                if (!disposed && current === generation) {
                    const notify = !refreshingSilently || before !== discoveryState()
                    busy = false
                    refreshingSilently = false
                    discovered = true
                    if (notify) {
                        changed.fire()
                    }
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
        await refresh(true)
    }

    const browse = async () => {
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
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
            throw new Error(`Cannot use OpenSCAD: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    const useRuntime = async (id: string) => {
        if (selectingId || installing || deletingId) {
            return
        }
        selectingId = id
        changed.fire()
        try {
            await pending
            const requested = manager.result.runtimes.find((runtime) => runtime.id === id)
            if (!requested) {
                throw new Error('This runtime is no longer available. Select another installed version.')
            }
            await saveCommand(requested.command)
        } finally {
            selectingId = undefined
            changed.fire()
        }
    }

    const select = async (requestedId?: string) => {
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
        }
        if (requestedId) {
            await useRuntime(requestedId)
            return
        }
        await pending
        const choices: (vscode.QuickPickItem & {
            runtime?: Runtime
            action?: string
        })[] = sortRuntimesByVersion(manager.result.runtimes).map((runtime) => ({
            label: `OpenSCAD ${runtime.version}`,
            description: runtime.command.executable,
            runtime,
        }))
        choices.push({ label: 'Download Other OpenSCAD CLI Versions…', action: 'download' })
        const choice = await vscode.window.showQuickPick(choices, {
            title: 'OpenSCAD Runtime',
            matchOnDescription: true,
        })
        if (choice?.runtime) {
            await useRuntime(choice.runtime.id)
        } else if (choice?.action === 'download') {
            await vscode.commands.executeCommand('scad-ai.runtime.open', 'available')
        }
    }

    const runInstallation = async (label: string, buildId: number | undefined, install: (options: InstallOptions) => Promise<string>) => {
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
        }
        // A silent scan leaves the UI usable; finish that scan before modifying files.
        await pending
        if (installing || deletingId) {
            return
        }
        const abort = new AbortController()
        installationAbort = abort
        installing = { buildId, label, message: 'Preparing installation…' }
        installationMessage = ''
        installationError = ''
        installationIsArchive = buildId === undefined
        changed.fire()
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing ${label}`, cancellable: true }, async (progress, token) => {
                const cancellation = token.onCancellationRequested(() => abort.abort())
                if (token.isCancellationRequested) {
                    abort.abort()
                }
                try {
                    await install({
                        request,
                        signal: abort.signal,
                        progress: (value) => {
                            installing = { ...value, label }
                            progress.report({ message: value.message + (value.percent === undefined ? '' : ` ${value.percent}%`) })
                            if (!disposed) {
                                changed.fire()
                            }
                        },
                    })
                } finally {
                    cancellation.dispose()
                }
            })
            installationMessage = `${label} installed. Manage runtimes in the Installed tab.`
        } catch (error) {
            installationMessage = abort.signal.aborted ? 'Installation cancelled.' : `Installation failed: ${error instanceof Error ? error.message : String(error)}`
            installationError = abort.signal.aborted ? '' : installationMessage
            if (!disposed) {
                output.appendLine(installationMessage)
            }
            if (!abort.signal.aborted) {
                throw new Error(installationMessage)
            }
        } finally {
            installing = undefined
            installationAbort = undefined
            if (!disposed) {
                await refresh(true)
                // Completion must reach the UI even when reinstalling leaves discovery unchanged.
                changed.fire()
            }
        }
    }

    const installArchive = async () => {
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
        }
        if (installing || deletingId) {
            return
        }
        const files = await vscode.window.showOpenDialog({
            title: 'Install OpenSCAD CLI from Archive',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'OpenSCAD CLI archives': ['zip', 'gz'] },
            openLabel: 'Install Runtime',
        })
        if (!files?.[0]) {
            return
        }
        system ??= await detectRuntimeSystem()
        const source = files[0].fsPath
        await runInstallation(path.basename(source), undefined, (options) => installRuntimeArchive(runtimesRoot, system!, source, options))
    }

    const deleteRuntime = async (id: string) => {
        if (!vscode.workspace.isTrusted) throw new UserWarning(workspaceTrustMessage)
        if (installing || selectingId || deletingId) return
        deletingId = id
        changed.fire()
        try {
            await pending
            const runtime = manager.result.runtimes.find((runtime) => runtime.id === id)
            if (!runtime?.installPath || !system) {
                throw new UserWarning('Only extension-managed runtime installations can be deleted.')
            }
            const deletesActive = manager.active?.installPath === runtime.installPath
            await removeRuntimeInstallation(runtimesRoot, system, runtime.installPath)
            if (deletesActive) await saveCommand(null)
        } finally {
            try {
                await refresh(true)
            } finally {
                deletingId = undefined
                changed.fire()
            }
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
                installationAbort?.abort()
            },
        },
        vscode.commands.registerCommand('scad-ai-ide.refreshRuntimes', refresh),
        vscode.commands.registerCommand('scad-ai-ide.selectRuntime', select),
        vscode.commands.registerCommand('scad-ai-ide.addRuntime', browse),
        vscode.commands.registerCommand('scad-ai-ide.installRuntimeArchive', installArchive),
        vscode.workspace.onDidGrantWorkspaceTrust(() => refresh()),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!saving && (event.affectsConfiguration(`${section}.openscadPath`) || event.affectsConfiguration(`${section}.runtimeCommand`))) {
                void refresh(true)
            }
        }),
    )
    void refresh()
    return {
        getActiveRuntime: () => manager.active,
        whenReady: () => pending,
        getState: () => ({
            runtimes: sortRuntimesByVersion(manager.result.runtimes),
            activeId: manager.active?.id,
            busy,
            refreshingSilently,
            selectingId,
            deletingId,
            message,
            messageSeverity: vscode.workspace.isTrusted ? 'error' : 'warning',
            system,
            builds,
            buildsBusy,
            buildsError,
            buildsLoaded,
            installing,
            installationMessage,
            installationError,
            installationIsArchive,
            installedBuildIds: installedBuilds.map((build) => build.id),
        }),
        loadBuilds,
        deleteRuntime,
        installArchive,
        installBuild: async (id: number) => {
            const build = builds.find((build) => build.id === id)
            if (!build || !system) {
                throw new Error('This build is unavailable. Refresh the build list and try again.')
            }
            const previous = manager.active
            const installed = await installedRuntimeBuilds(runtimesRoot, system, [build])
            const replacesActive = previous?.installPath && installed.some((entry) => entry.directories.includes(previous.installPath!))
            await runInstallation(build.release, id, async (options) => {
                const executable = await installRuntimeBuild(runtimesRoot, system!, build, { ...options, onRemoved: () => refresh(true) })
                // An offline import can move from a content-hash directory to an asset
                // directory during reinstall. Keep its active selection pointing at the replacement.
                if (replacesActive && previous.command.executable !== executable) {
                    await saveCommand({ ...previous.command, executable })
                }
                return executable
            })
        },
        onDidChange: changed.event,
        refresh,
        refreshInstalled: () => (busy || installing || selectingId || deletingId ? pending : refresh(true)),
        browse,
        select,
    }
}
