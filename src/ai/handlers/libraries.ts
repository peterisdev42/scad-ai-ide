import { page } from './page'
import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import { type ToolHandler, type ToolDependencies } from '../contracts/ToolServices'

const librarySnapshot = async ({ libraries, libraryRevision }: ToolDependencies, input: Record<string, unknown>, global: boolean) => {
    const state = await libraries.getState()
    return {
        revision: libraryRevision(),
        ...libraries.activity(),
        status: state.registryBusy ? 'loading' : state.registryError ? 'error' : state.registryLoaded ? 'ready' : 'notLoaded',
        registryError: state.registryError,
        registryStatus: state.registryStatus,
        ...(global
            ? {
                  cache: page(
                      state.global.map((entity) => ({ ...entity, versions: entity.versions.slice(0, 10), references: { ...entity.references, projects: entity.references.projects.slice(0, 10), unavailable: entity.references.unavailable.slice(0, 10), total: entity.references.projects.length + entity.references.unavailable.length } })),
                      input,
                  ),
                  issues: state.globalIssues.slice(0, 50),
              }
            : {
                  libraries: page(
                      state.registry.filter((l) => !input.query || JSON.stringify([l.id, l.name]).toLowerCase().includes(String(input.query).toLowerCase())),
                      input,
                  ),
              }),
    }
}
const projectSnapshot = async ({ libraries, libraryRevision }: ToolDependencies, project: string, input: Record<string, unknown> = {}) => {
    const state = await libraries.projectState(project)
    return { revision: libraryRevision(), ...libraries.activity(), project, dependencies: page(state.dependencies, input), affectedDependency: input.id ? state.dependencies.find((entry) => entry.id === input.id) : undefined }
}
export const searchHandler: ToolHandler = async (input, _context, { libraries, libraryRevision }) => {
    const matches = await libraries.search(String(input.query ?? ''), input.id as string | undefined)
    const rows = matches.map(({ versions, ...library }) => ({ ...library, versions: page(versions, input.id ? input : { offset: 0, limit: 3 }) }))
    return { revision: libraryRevision(), status: libraries.manager.registry.status, error: libraries.manager.registry.error, ...(input.id ? { library: rows[0] } : { libraries: page(rows, input) }) }
}

export const refreshHandler: ToolHandler = async (input, _context, services) => {
    const { libraries } = services
    await libraries.loadRegistry()
    const state = await libraries.getState()
    if (state.registryError) throw new CapabilityError('REGISTRY_FAILED', state.registryError, true)
    return librarySnapshot(services, input, false)
}

export const projectStateHandler: ToolHandler = async (input, _context, services) => {
    const { libraries, libraryRevision } = services
    return input.project ? projectSnapshot(services, String(input.project), input) : { revision: libraryRevision(), ...libraries.activity(), projects: page(await libraries.projects(), input) }
}

export const globalStateHandler: ToolHandler = (input, _context, services) => {
    return librarySnapshot(services, input, true)
}

export const installHandler: ToolHandler = async (input, ctx, services) => {
    const { libraries } = services
    await libraries.execute({ ...input, action: 'libraries.install' }, ctx)
    return projectSnapshot(services, String(input.project), input)
}

export const removeHandler: ToolHandler = async (input, ctx, services) => {
    const { libraries } = services
    await libraries.execute({ ...input, action: 'libraries.remove' }, ctx)
    return projectSnapshot(services, String(input.project), input)
}

export const restoreHandler: ToolHandler = async (input, ctx, services) => {
    const { libraries } = services
    await libraries.execute({ ...input, action: 'libraries.restore' }, ctx)
    return projectSnapshot(services, String(input.project), input)
}

export const verifyHandler: ToolHandler = async (input, ctx, services) => {
    const { libraries } = services
    await libraries.execute({ action: input.key ? 'libraries.verify' : 'libraries.verifyAll', key: input.key }, ctx)
    return { ...(await librarySnapshot(services, input, true)), summary: (await libraries.getState()).bulkResult || 'File inventory verified, not independent supply-chain authenticity.' }
}

export const repairHandler: ToolHandler = async (input, ctx, services) => {
    const { libraries } = services
    await libraries.execute({ action: 'libraries.repairGlobal', key: input.key }, ctx)
    return librarySnapshot(services, input, true)
}

export const cleanupPlanHandler: ToolHandler = (input, _context, { libraries }) => {
    if (input.key && input.mode) throw new CapabilityError('INVALID_INPUT', 'Choose key or mode, not both.')
    return libraries.planCleanup(input as { key?: string; mode?: 'unused' | 'all' })
}

export const cleanupExecuteHandler: ToolHandler = (input, _context, { libraries }) => {
    return libraries.executeCleanup(String(input.planId))
}
