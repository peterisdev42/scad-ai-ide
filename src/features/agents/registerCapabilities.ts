import type { CadWorkspaceService } from '../cad-verification/CadWorkspaceService'
import { meshReportSummary } from '../../core/mesh/summary'
import { reportSummary } from '../../core/cad/summary'
import { safePreview } from '../../core/capabilities/SafeOutput'
import type { CustomizerSourceDomainService } from '../sidebar/CustomizerSourceDomainService'
import type { SourceExpectation } from '../../core/customizer/CustomizerSourceTypes'
import * as vscode from 'vscode'
import { capabilityCatalog, CapabilityRegistry } from '../../core/capabilities/CapabilityRegistry'
import { CapabilityDispatcher } from '../../core/capabilities/CapabilityDispatcher'
import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import type { createRuntimeService } from '../runtime/RuntimeService'
import type { LibraryService } from '../libraries/LibraryService'
import type { CustomizerDomainService } from '../sidebar/CustomizerDomainService'
import type { DeveloperCacheController } from '../development/DeveloperCacheController'
import type { registerGitHub } from '../github/registerGitHub'
import type { ParameterValue } from '../../core/customizer/CustomizerParser'

export interface CapabilityServices {
    cad?: CadWorkspaceService
    runtime: ReturnType<typeof createRuntimeService>
    libraries: LibraryService
    customizerSource: CustomizerSourceDomainService
    customizer: CustomizerDomainService
    github: ReturnType<typeof registerGitHub>
    development: DeveloperCacheController
}
const page = <T>(items: T[], input: Record<string, unknown>) => {
    const offset = Number(input.offset ?? 0)
    const result = items.slice(offset, offset + Number(input.limit ?? 20))
    const next = offset + result.length
    return { total: items.length, offset, items: result, hasMore: next < items.length, nextOffset: next < items.length ? next : null }
}

/** Binds domain methods, never GUI adapters. Every catalog entry must have one handler. */
export function registerCapabilities(services: CapabilityServices) {
    const { runtime, libraries, customizer, customizerSource, github, development, cad } = services
    const registry = new CapabilityRegistry()
    const dispatcher = new CapabilityDispatcher(registry)
    let runtimeRevision = 0
    let libraryRevision = 0
    const subscriptions = [runtime.onDidChange(() => runtimeRevision++), libraries.onDidChange(() => libraryRevision++)]
    const runtimeSnapshot = (input: Record<string, unknown> = {}) => {
        const { builds, ...state } = runtime.getState()
        const installed = page(state.runtimes, input)
        // Always return the selected CLI in full, even when it is outside the requested page.
        const activeRuntime = state.runtimes.find((entry) => entry.id === state.activeId) ?? null
        return { revision: runtimeRevision, state: { ...state, activeRuntime, runtimes: installed, buildCount: builds.length, readiness: state.busy ? 'loading' : state.message ? 'error' : 'ready' } }
    }
    const librarySnapshot = async (input: Record<string, unknown>, global: boolean) => {
        const state = await libraries.getState()
        return {
            revision: libraryRevision,
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
    const projectSnapshot = async (project: string, input: Record<string, unknown> = {}) => {
        const state = await libraries.projectState(project)
        return { revision: libraryRevision, ...libraries.activity(), project, dependencies: page(state.dependencies, input), affectedDependency: input.id ? state.dependencies.find((entry) => entry.id === input.id) : undefined }
    }
    const runtimeMutation = async (ctx: CapabilityContext, task: () => Promise<void>) => {
        const subscription = runtime.onDidChange(() => {
            const state = runtime.getState()
            if (state.installing) ctx.report?.(state.installing.message)
        })
        try {
            await task()
            return runtimeSnapshot()
        } finally {
            subscription.dispose()
        }
    }
    const handlers: Record<string, (input: Record<string, unknown>, ctx: CapabilityContext) => unknown> = {
        'cad.modelAnalyze': async (input, ctx) => {
            if (input.mode === 'verify') {
                ctx.report?.('Verifying the frozen raw mesh; no mesh repair is applied.')
                return meshReportSummary(await cad!.geometry!.verify(input as unknown as import('../../core/mesh/types').VerifyMeshInput, ctx.signal))
            }
            ctx.report?.('Evaluating official CLI diagnostics; geometry checks are not examined.')
            const report = await cad!.analyze(input as unknown as import('../../core/cad/CadVerificationService').AnalyzeInput, ctx.signal)
            ctx.report?.(`CLI diagnostics: ${report.overallStatus}`)
            return reportSummary(report)
        },
        'cad.issueDetails': (input) => cad!.issueDetails(String(input.reportId), String(input.issueId), input.includeEvidence === true, Number(input.cursor ?? 0), Number(input.limit ?? 100)),
         'cad.modelMeasure': (input, ctx) => {
            if(input.partIds && !(typeof input.reportId==='string'&&cad!.assembly!.core.has(input.reportId)))throw new CapabilityError('PART_IDS_REQUIRE_ASSEMBLY','partIds requires an existing v3 assembly report.')
            return typeof input.reportId==='string'&&cad!.assembly!.core.has(input.reportId)?cad!.assembly!.measure(input as import('../../core/mesh/types').MeshReference):cad!.geometry!.measure(input as import('../../core/mesh/types').MeshReference,ctx.signal)
        },
        'cad.modelRenderViews': (input, ctx) => {
            if(input.partIds && !(typeof input.reportId==='string'&&cad!.assembly!.core.has(input.reportId)))throw new CapabilityError('PART_IDS_REQUIRE_ASSEMBLY','partIds requires an existing v3 assembly report.')
            return typeof input.reportId==='string'&&cad!.assembly!.core.has(input.reportId)?cad!.assembly!.renderViews(input as import('../../core/mesh/types').RenderViewsInput,ctx.signal):cad!.geometry!.renderViews(input as import('../../core/mesh/types').RenderViewsInput,ctx.signal)
        },
        'cad.listParts': input => cad!.assembly!.list(input),
        'cad.checkAssembly': (input,ctx) => cad!.assembly!.check(input,ctx.signal),
        'capabilities.discover': (input, ctx) => registry.discover(ctx, Number(input.offset ?? 0), Number(input.limit ?? 20)),
        'operation.status': (input) => dispatcher.operations.status(input.id as string | undefined, Number(input.offset ?? 0), Number(input.limit ?? 20)),
        'operation.cancel': (input) => {
            if (input.domain) {
                const requested = input.domain === 'runtime' ? runtime.cancel() : libraries.cancel()
                return { domain: input.domain, cancellationRequested: requested, status: requested ? 'cancellationRequested' : 'noCancellableTask', message: 'Cancellation is cooperative. Read domain state until the operation finishes; critical transactions may complete.' }
            }
            return dispatcher.operations.cancel(String(input.id))
        },
        'runtime.state': async (input) => {
            await runtime.whenReady()
            return runtimeSnapshot(input)
        },
        'runtime.builds': async (input) => {
            await runtime.whenReady()
            const before = runtime.getState()
            if (input.refresh === true || (!before.buildsLoaded && !before.builds.length)) await runtime.loadBuilds(input.refresh === true)
            const state = runtime.getState()
            if (state.buildsError && (input.refresh === true || !state.builds.length)) throw new CapabilityError('CATALOG_FAILED', state.buildsError, true)
            return {
                revision: runtimeRevision,
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
        },
        'runtime.refresh': async (input) => {
            if (input.mode === 'installed') await runtime.refreshInstalled()
            else await runtime.refresh()
            const state = runtime.getState()
            if (/Detection failed:/.test(state.message)) throw new CapabilityError('DISCOVERY_FAILED', state.message, true)
            return runtimeSnapshot()
        },
        'runtime.installBuild': (input, ctx) =>
            runtimeMutation(ctx, async () => {
                await runtime.installBuild(Number(input.id), ctx.signal)
                if (!runtime.getState().installedBuildIds.includes(Number(input.id))) throw new CapabilityError('POSTCONDITION_FAILED', 'Installation returned but the requested build is not in the installed inventory. Refresh Runtime state.', true)
            }),
        'runtime.installArchive': (input, ctx) => runtimeMutation(ctx, () => runtime.installArchivePath(String(input.path), ctx.signal)),
        'runtime.addExecutable': async (input) => {
            await runtime.addExecutable(String(input.path))
            return runtimeSnapshot()
        },
        'runtime.select': async (input) => {
            await runtime.select(String(input.id))
            if (runtime.getActiveRuntime()?.id !== input.id) throw new CapabilityError('POSTCONDITION_FAILED', 'Requested runtime did not become active. Refresh discovery.', true)
            return runtimeSnapshot()
        },
        'runtime.remove': async (input) => {
            await runtime.deleteRuntime(String(input.id))
            if (runtime.getState().runtimes.some((entry) => entry.id === input.id)) throw new CapabilityError('POSTCONDITION_FAILED', 'Removal returned but the runtime is still detected. Refresh Runtime state.', true)
            return runtimeSnapshot()
        },
        'customizer.sourceAnalyze': (input) => customizerSource.analyze(String(input.uri), input),
        'customizer.sourceApply': (input, ctx) => customizerSource.apply(input, ctx),
        'customizer.sourceValidate': (input) => customizerSource.validate(String(input.uri), input.expectations as SourceExpectation[] | undefined, input.includeWarnings as boolean | undefined),
        'customizer.state': () => customizer.snapshot(),
        'customizer.set': (input) => customizer.setValues(String(input.target), Number(input.revision), input.values as Record<string, ParameterValue>),
        'customizer.reset': (input) => customizer.reset(String(input.target), Number(input.revision), input.name as string | undefined),
        'libraries.search': async (input) => {
            const matches = await libraries.search(String(input.query ?? ''), input.id as string | undefined)
            const rows = matches.map(({ versions, ...library }) => ({ ...library, versions: page(versions, input.id ? input : { offset: 0, limit: 3 }) }))
            return { revision: libraryRevision, status: libraries.manager.registry.status, error: libraries.manager.registry.error, ...(input.id ? { library: rows[0] } : { libraries: page(rows, input) }) }
        },
        'libraries.refresh': async (input) => {
            await libraries.loadRegistry()
            const state = await libraries.getState()
            if (state.registryError) throw new CapabilityError('REGISTRY_FAILED', state.registryError, true)
            return librarySnapshot(input, false)
        },
        'libraries.projectState': async (input) => (input.project ? projectSnapshot(String(input.project), input) : { revision: libraryRevision, ...libraries.activity(), projects: page(await libraries.projects(), input) }),
        'libraries.globalState': (input) => librarySnapshot(input, true),
        'libraries.verify': async (input, ctx) => {
            await libraries.execute({ action: input.key ? 'libraries.verify' : 'libraries.verifyAll', key: input.key }, ctx)
            return { ...(await librarySnapshot(input, true)), summary: (await libraries.getState()).bulkResult || 'File inventory verified, not independent supply-chain authenticity.' }
        },
        'libraries.repair': async (input, ctx) => {
            await libraries.execute({ action: 'libraries.repairGlobal', key: input.key }, ctx)
            return librarySnapshot(input, true)
        },
        'libraries.cleanupPlan': (input) => {
            if (input.key && input.mode) throw new CapabilityError('INVALID_INPUT', 'Choose key or mode, not both.')
            return libraries.planCleanup(input as { key?: string; mode?: 'unused' | 'all' })
        },
        'libraries.cleanupExecute': (input) => libraries.executeCleanup(String(input.planId)),
        'more.githubStatus': async () => {
            await github.refresh()
            const { mode, busy, account, loginSuggested, message } = github.getState()
            return { mode, busy, account, loginSuggested, message: message ? safePreview(message) : undefined }
        },
        'more.authorizeGitHub': async () => {
            await github.connect()
            await runtime.loadBuilds(true)
            const { mode, busy, account, loginSuggested, message } = github.getState()
            return { mode, busy, account, loginSuggested, message: message ? safePreview(message) : undefined }
        },
        'development.status': () => ({ enabled: development.enabled, reason: development.enabled ? undefined : 'DEVELOPMENT_ONLY' }),
        'development.listCaches': (input) => development.listSafe(Number(input.offset ?? 0), Number(input.limit ?? 20)),
        'development.inspectCache': (input) => development.inspectSafe(String(input.id)),
        'development.clearCaches': (input) => {
            if (Object.keys(input).length !== 1) throw new CapabilityError('INVALID_INPUT', 'Choose exactly one cache ID, scope or all=true.')
            return development.clearSafe(input)
        },
    }
    for (const [operation, action] of Object.entries({ applyPreset: 'select', createPreset: 'new', savePreset: 'save', deletePreset: 'delete', importPresets: 'import', exportPresets: 'export' })) {
        handlers[`customizer.${operation}`] = (input, ctx) => customizer.preset(String(input.target), Number(input.revision), action, input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
    }
    for (const action of ['install', 'remove', 'restore']) {
        handlers[`libraries.${action}`] = async (input, ctx) => {
            await libraries.execute({ ...input, action: `libraries.${action}` }, ctx)
            return projectSnapshot(String(input.project), input)
        }
    }
    for (const definition of capabilityCatalog) {
        if (!handlers[definition.id]) throw new Error(`No binding for ${definition.id}`)
        registry.bind(definition.id, {
            available: () => {
                if (definition.id.startsWith('cad.')) {
                    if (!cad) return { enabled: false, reasonCode: 'NOT_REGISTERED' }
                    if (!vscode.workspace.isTrusted) return { enabled: false, reasonCode: 'UNTRUSTED_WORKSPACE' }
                    return definition.id === 'cad.issueDetails' ? { enabled: true } : (cad.geometry?.availability() ?? cad.availability())
                }
                if (definition.id.startsWith('development.') && definition.id !== 'development.status' && !development.enabled) return { enabled: false, reasonCode: 'DEVELOPMENT_ONLY' }
                if ((definition.risk !== 'read' || ['libraries.verify', 'libraries.cleanupPlan'].includes(definition.id)) && !definition.id.startsWith('more.') && !definition.id.startsWith('development.') && !['operation.cancel', 'customizer.set', 'customizer.reset', 'customizer.applyPreset'].includes(definition.id) && !vscode.workspace.isTrusted) return { enabled: false, reasonCode: 'UNTRUSTED_WORKSPACE' }
                if (definition.risk !== 'read') {
                    if (definition.id.startsWith('runtime.')) {
                        const state = runtime.getState()
                        if (state.installing || state.selectingId || state.deletingId) return { enabled: false, reasonCode: 'BUSY' }
                    }
                    if (definition.id.startsWith('libraries.') && libraries.isBusy()) return { enabled: false, reasonCode: 'BUSY' }
                    if (definition.id.startsWith('customizer.') && customizer.isBusy()) return { enabled: false, reasonCode: 'BUSY' }
                    if (definition.id.startsWith('development.') && development.isBusy()) return { enabled: false, reasonCode: 'BUSY' }
                }
                return { enabled: true }
            },
            invoke: handlers[definition.id],
        })
    }
    registry.assertComplete()
    return {
        dispatcher,
        dispose() {
            dispatcher.operations.dispose()
            subscriptions.forEach((s) => s.dispose())
        },
    }
}
