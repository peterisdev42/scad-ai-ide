import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { confirmCapabilityAction } from '../../platform/notifications'
import { memoryCaches } from '../../core/cache/CacheRegistry'
import type { GitHubRequest } from '../../platform/github/client'
import * as vscode from 'vscode'
import { fileCandidate, probe, type Runtime, type LaunchCommand } from '../../platform/runtime/discovery'
import { resolveApplication } from '../../platform/runtime/platformDiscovery'
import { RuntimeManager } from '../../core/runtime/RuntimeManager'
import { sortRuntimesByVersion } from '../../core/runtime/sortRuntimes'
import { UserWarning } from '../../core/feedback'
import { classifyRuntimeRelease, detectRuntimeSystem, fetchRuntimeBuilds, fetchLatestRuntimeTag, type RuntimeBuild, type RuntimeSystem } from '../../platform/runtime/releases'
import { installRuntimeArchive, installRuntimeBuild, removeRuntimeInstallation, installedRuntimeBuilds, managedRuntimePaths, type InstalledRuntimeBuild, type InstallProgress, type InstallOptions } from '../../platform/runtime/installation'
import * as path from 'node:path'
import { notifications } from '../../platform/notifications'
import { loadLegacyRuntimeCatalogCache, readRuntimeCatalogCache, runtimeCatalogCacheKey, type RuntimeCatalogCache } from '../../platform/runtime/catalogCache'

const section = 'scad-ai-ide'
const workspaceTrustMessage = 'Trust this workspace to discover, add, or run OpenSCAD runtimes.'

export interface RuntimePresentation {
    output: Pick<vscode.OutputChannel, 'appendLine'>
    status: Pick<vscode.StatusBarItem, 'text' | 'tooltip'>
    withProgress: typeof vscode.window.withProgress
}
export function createRuntimeService(context: vscode.ExtensionContext, manager: RuntimeManager, request: GitHubRequest, presentation: RuntimePresentation) {
    const { output, status } = presentation
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
    let recommendedBuildId: number | undefined
    let installedBuilds: InstalledRuntimeBuild[] = []
    let buildsBusy = false
    let buildsError = ''
    let buildsLoaded = false
    let buildsPending: Promise<void> | undefined
    let cacheRestorePending: Promise<void> | undefined
    let installing: InstallProgress | undefined
    let installationMessage = ''
    let installationError = ''
    let installationIsArchive = false
    let installationAbort: AbortController | undefined
    const runtimesRoot = vscode.Uri.joinPath(context.globalStorageUri, 'runtimes').fsPath

    const persistBuildCache = async (cache: RuntimeCatalogCache) => {
        try {
            await context.globalState.update(runtimeCatalogCacheKey(system!), cache)
        } catch (error) {
            output.appendLine(`Could not save Runtime catalog cache: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    const restoreBuildCache = (): Promise<void> => {
        if (!system) return Promise.resolve()
        const cached = readRuntimeCatalogCache(context.globalState.get(runtimeCatalogCacheKey(system)), system)
        if (cached) {
            builds = cached.builds
            recommendedBuildId = cached.recommendedBuildId
            return Promise.resolve()
        }
        // Import the previous file cache only when globalState has no usable catalog.
        return (cacheRestorePending ??= (async () => {
            const legacy = await loadLegacyRuntimeCatalogCache(context.globalStorageUri.fsPath, system!)
            if (legacy) {
                builds = legacy.builds
                recommendedBuildId = legacy.recommendedBuildId
                if (!disposed) changed.fire()
                await persistBuildCache(legacy)
            }
        })())
    }

    const loadBuilds = (force = false): Promise<void> => {
        if (buildsPending) {
            // A newly authorized account must refresh even if an anonymous request
            // was already running when the user connected GitHub.
            return force ? buildsPending.then(() => loadBuilds(true)) : buildsPending
        }
        buildsBusy = true
        buildsError = ''
        changed.fire()
        buildsPending = (async () => {
            system ??= await detectRuntimeSystem()
            await restoreBuildCache()
            if (!disposed) {
                changed.fire()
            }
            const [available, latestTag] = await Promise.all([fetchRuntimeBuilds(system, request), fetchLatestRuntimeTag(request)])
            builds = available
            recommendedBuildId = builds.find((build) => build.tag === latestTag && build.channel === 'Stable')?.id
            buildsLoaded = true
            if (!disposed) changed.fire()
            const cache: RuntimeCatalogCache = { version: 1, builds, recommendedBuildId }
            await Promise.all([
                persistBuildCache(cache),
                installedRuntimeBuilds(runtimesRoot, system, builds).then((installed) => {
                    installedBuilds = installed
                }),
            ])
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
                await restoreBuildCache()
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

    const addExecutable = async (file: string) => {
        if (!path.isAbsolute(file)) throw new CapabilityError('INVALID_PATH', 'Use an absolute extension-host executable path.')
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
        }
        if (selectingId || installing || deletingId) throw new CapabilityError('BUSY', 'A runtime mutation is already running.', true)
        selectingId = 'custom-executable'
        changed.fire()
        try {
            const candidate = process.platform === 'darwin' ? await resolveApplication(fileCandidate(file, 'custom')) : fileCandidate(file, 'custom')
            await probe(candidate)
            await saveCommand(candidate.command)
        } catch (error) {
            throw new Error(`Cannot use OpenSCAD: ${error instanceof Error ? error.message : String(error)}`)
        } finally { selectingId = undefined; changed.fire() }
    }

    const useRuntime = async (id: string) => {
        if (selectingId || installing || deletingId) {
            throw new CapabilityError('BUSY', 'A runtime mutation is already running.', true)
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

    const select = async (id: string) => {
        if (!vscode.workspace.isTrusted) throw new UserWarning(workspaceTrustMessage)
        await useRuntime(id)
    }

    const runInstallation = async (label: string, buildId: number | undefined, install: (options: InstallOptions) => Promise<string>, signal?: AbortSignal) => {
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
        }
        // A silent scan leaves the UI usable; finish that scan before modifying files.
        await pending
        if (installing || selectingId || deletingId) {
            throw new CapabilityError('BUSY', 'A runtime mutation is already running.', true)
        }
        const abort = new AbortController()
        const cancel = () => abort.abort()
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) abort.abort()
        installationAbort = abort
        installing = { buildId, label, message: 'Preparing installation…' }
        installationMessage = ''
        installationError = ''
        installationIsArchive = buildId === undefined
        changed.fire()
        try {
            await presentation.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing ${label}`, cancellable: true }, async (progress, token) => {
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
            throw new CapabilityError(abort.signal.aborted ? 'CANCELLED' : 'INSTALL_FAILED', installationMessage, true)
        } finally {
            installing = undefined
            installationAbort = undefined
            signal?.removeEventListener('abort', cancel)
            if (!disposed) {
                await refresh(true)
                // Completion must reach the UI even when reinstalling leaves discovery unchanged.
                changed.fire()
            }
        }
    }

    const installArchivePath = async (source: string, signal?: AbortSignal) => {
        if (!path.isAbsolute(source)) throw new CapabilityError('INVALID_PATH', 'Use an absolute extension-host archive path.')
        if (!vscode.workspace.isTrusted) {
            throw new UserWarning(workspaceTrustMessage)
        }
        if (installing || selectingId || deletingId) {
            throw new CapabilityError('BUSY', 'A runtime mutation is already running.', true)
        }
        system ??= await detectRuntimeSystem()
        await runInstallation(path.basename(source), undefined, (options) => installRuntimeArchive(runtimesRoot, system!, source, options), signal)
    }

    const deleteRuntime = async (id: string) => {
        if (!vscode.workspace.isTrusted) throw new UserWarning(workspaceTrustMessage)
        if (installing || selectingId || deletingId) throw new CapabilityError('BUSY', 'A runtime mutation is already running.', true)
        deletingId = id
        changed.fire()
        try {
            await pending
            const runtime = manager.result.runtimes.find((runtime) => runtime.id === id)
            if (!runtime?.installPath || !system) {
                throw new UserWarning('Only extension-managed runtime installations can be deleted.')
            }
            if (!(await confirmCapabilityAction('Remove managed runtime', runtime.installPath))) throw new CapabilityError('CANCELLED', 'Runtime removal cancelled.')
            if (!vscode.workspace.isTrusted) throw new UserWarning(workspaceTrustMessage)
            if (manager.result.runtimes.find((entry) => entry.id === id)?.installPath !== runtime.installPath) throw new CapabilityError('STALE_STATE', 'Runtime identity changed. Refresh and retry.', true)
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

    const clearCatalogCache = async () => {
        await buildsPending
        await pending
        builds = []
        recommendedBuildId = undefined
        buildsLoaded = false
        buildsError = ''
        cacheRestorePending = undefined
    }
    context.subscriptions.push(
        memoryCaches.register('Runtime catalog', () => ({ system, builds, recommendedBuildId, loaded: buildsLoaded }), clearCatalogCache),
        changed,
        {
            dispose: () => {
                disposed = true
                generation++
                installationAbort?.abort()
            },
        },
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
            runtimes: sortRuntimesByVersion(manager.result.runtimes).map((runtime) => {
                // Prefer the same Release classification shown in Available, then saved offline metadata.
                const tag = runtime.tag?.replace(/^openscad-cli-/, 'openscad-')
                const build = tag ? builds.find((build) => build.tag.replace(/^openscad-cli-/, 'openscad-') === tag) : undefined
                return { ...runtime, channel: build?.channel ?? runtime.channel ?? classifyRuntimeRelease({ tag_name: runtime.tag ?? runtime.version }) }
            }),
            activeId: manager.active?.id,
            discovery: {
                status: !vscode.workspace.isTrusted ? 'restricted' : busy ? 'discovering' : !discovered ? 'notStarted' : message ? 'error' : 'ready',
                scope: 'extensionHost',
                configuredError: manager.result.configuredError ?? null,
                diagnostics: manager.result.diagnostics.slice(0, 50).map((entry) => entry.slice(0, 1000)),
                omittedDiagnostics: Math.max(0, manager.result.diagnostics.length - 50),
            },
            busy,
            refreshingSilently,
            selectingId,
            deletingId,
            message,
            messageSeverity: vscode.workspace.isTrusted ? 'error' : 'warning',
            system,
            builds,
            recommendedBuildId,
            buildsBusy,
            buildsError,
            buildsLoaded,
            installing,
            installationMessage,
            installationError,
            installationIsArchive,
            installedBuildIds: installedBuilds.map((build) => build.id),
        }),
        clearCatalogCache,
        loadBuilds,
        deleteRuntime,
        installArchivePath,
        addExecutable,
        cancel: () => {
            if (!installationAbort) return false
            installationAbort.abort()
            return true
        },
        installBuild: async (id: number, signal?: AbortSignal) => {
            const build = builds.find((build) => build.id === id)
            if (!build || !system) {
                throw new Error('This build is unavailable. Refresh the build list and try again.')
            }
            const previous = manager.active
            const installed = await installedRuntimeBuilds(runtimesRoot, system, [build])
            const replacesActive = previous?.installPath && installed.some((entry) => entry.directories.includes(previous.installPath!))
            await runInstallation(build.release, id, async (options) => {
                if (JSON.stringify(builds.find((entry) => entry.id === id)) !== JSON.stringify(build)) throw new CapabilityError('STALE_STATE', 'Build catalog changed. Refresh and choose the exact build again.', true)
                const executable = await installRuntimeBuild(runtimesRoot, system!, build, { ...options, onRemoved: () => refresh(true) })
                // An offline import can move from a content-hash directory to an asset
                // directory during reinstall. Keep its active selection pointing at the replacement.
                if (replacesActive && manager.active?.id === previous.id && previous.command.executable !== executable) {
                    await saveCommand({ ...previous.command, executable })
                }
                return executable
            }, signal)
        },
        onDidChange: changed.event,
        refresh,
        refreshInstalled: () => (busy || installing || selectingId || deletingId ? pending : refresh(true)),
        select,
    }
}
