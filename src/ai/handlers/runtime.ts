import { page } from './page'
import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import { type ToolHandler, type ToolDependencies } from '../contracts/ToolServices'

const runtimeSnapshot = ({ runtime, runtimeRevision }: ToolDependencies, input: Record<string, unknown> = {}) => {
    const { builds, ...state } = runtime.getState()
    const installed = page(state.runtimes, input)
    // Always return the selected CLI in full, even when it is outside the requested page.
    const activeRuntime = state.runtimes.find((entry) => entry.id === state.activeId) ?? null
    return { revision: runtimeRevision(), state: { ...state, activeRuntime, runtimes: installed, buildCount: builds.length, readiness: state.busy ? 'loading' : state.message ? 'error' : 'ready' } }
}
const runtimeMutation = async (services: ToolDependencies, ctx: CapabilityContext, task: () => Promise<void>) => {
    const subscription = services.runtime.onDidChange(() => {
        const state = services.runtime.getState()
        if (state.installing) ctx.report?.(state.installing.message)
    })
    try {
        await task()
        return runtimeSnapshot(services)
    } finally {
        subscription.dispose()
    }
}
export const stateHandler: ToolHandler = async (input, _context, services) => {
    const { runtime } = services
    await runtime.whenReady()
    return runtimeSnapshot(services, input)
}

export const buildsHandler: ToolHandler = async (input, _context, { runtime, runtimeRevision }) => {
    await runtime.whenReady()
    const before = runtime.getState()
    if (input.refresh === true || (!before.buildsLoaded && !before.builds.length)) await runtime.loadBuilds(input.refresh === true)
    const state = runtime.getState()
    if (state.buildsError && (input.refresh === true || !state.builds.length)) throw new CapabilityError('CATALOG_FAILED', state.buildsError, true)
    return {
        revision: runtimeRevision(),
        cached: !state.buildsLoaded || !!state.buildsError,
        error: state.buildsError,
        system: state.system,
        recommendedBuildId: state.recommendedBuildId,
        recommendedBuild: state.builds.find((build) => build.id === state.recommendedBuildId) ?? null,
        installedBuildIds: state.installedBuildIds,
        builds: page(
            state.builds.filter((b) => !input.channel || b.channel === input.channel).map((build) => ({ ...build, installed: state.installedBuildIds.includes(build.id) })),
            input,
        ),
    }
}

export const refreshHandler: ToolHandler = async (input, _context, services) => {
    const { runtime } = services
    if (input.mode === 'installed') await runtime.refreshInstalled()
    else await runtime.refresh()
    const state = runtime.getState()
    if (/Detection failed:/.test(state.message)) throw new CapabilityError('DISCOVERY_FAILED', state.message, true)
    return runtimeSnapshot(services)
}

export const installBuildHandler: ToolHandler = (input, ctx, services) => {
    const { runtime } = services
    return runtimeMutation(services, ctx, async () => {
        await runtime.installBuild(Number(input.id), ctx.signal)
        if (!runtime.getState().installedBuildIds.includes(Number(input.id))) throw new CapabilityError('POSTCONDITION_FAILED', 'Installation returned but the requested build is not in the installed inventory. Refresh Runtime state.', true)
    })
}

export const installArchiveHandler: ToolHandler = (input, ctx, services) => {
    const { runtime } = services
    return runtimeMutation(services, ctx, () => runtime.installArchivePath(String(input.path), ctx.signal))
}

export const addExecutableHandler: ToolHandler = async (input, _context, services) => {
    const { runtime } = services
    await runtime.addExecutable(String(input.path))
    return runtimeSnapshot(services)
}

export const selectHandler: ToolHandler = async (input, _context, services) => {
    const { runtime } = services
    await runtime.select(String(input.id))
    if (runtime.getActiveRuntime()?.id !== input.id) throw new CapabilityError('POSTCONDITION_FAILED', 'Requested runtime did not become active. Refresh discovery.', true)
    return runtimeSnapshot(services)
}

export const removeHandler: ToolHandler = async (input, _context, services) => {
    const { runtime } = services
    await runtime.deleteRuntime(String(input.id))
    if (runtime.getState().runtimes.some((entry) => entry.id === input.id)) throw new CapabilityError('POSTCONDITION_FAILED', 'Removal returned but the runtime is still detected. Refresh Runtime state.', true)
    return runtimeSnapshot(services)
}
