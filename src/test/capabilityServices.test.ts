import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as vm from 'node:vm'
import { CustomizerService } from '../core/customizer/CustomizerService'
import { CapabilityError } from '../core/capabilities/CapabilityTypes'
import { CapabilityRegistry, capabilityCatalog } from '../core/capabilities/CapabilityRegistry'
import guiActions from '../core/capabilities/gui-actions.json'
import { CapabilityDispatcher } from '../core/capabilities/CapabilityDispatcher'
import type * as vscode from 'vscode'

function guiInput(group: string, action: string, capability: string): Record<string, unknown> {
    const groups: Array<{ group: string; actions: Record<string, { uiOnly?: string; capabilities?: string[]; examples?: Array<{ capability: string; input: object }> } | undefined> }> = guiActions
    const example = groups.find((g) => g.group === group)?.actions[action]?.examples?.find((e) => e.capability === capability)
    assert.ok(example, `Missing GUI Agent contract: ${group}/${action}/${capability}`)
    return example.input as Record<string, unknown>
}

const disposable = { dispose() {} }
class Emitter {
    private listeners = new Set<(...values: unknown[]) => void>()
    event = (listener: (...values: unknown[]) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) } }
    fire(...values: unknown[]) { this.listeners.forEach((l) => l(...values)) }
    dispose() { this.listeners.clear() }
}
class Uri {
    scheme = 'file'; authority = ''; query = ''; fragment = ''
    constructor(readonly fsPath: string) {}
    get path() { return this.fsPath }
    toString() { return `file://${this.fsPath}` }
    with(value: { path?: string }) { return new Uri(value.path ?? this.path) }
    static file(value: string) { return new Uri(value) }
    static parse(value: string) { const url = new URL(value); const uri = new Uri(decodeURIComponent(url.pathname)); uri.scheme = url.protocol.slice(0, -1); uri.authority = url.host; uri.query = url.search.slice(1); uri.fragment = url.hash.slice(1); return uri }
    static joinPath(base: Uri, ...parts: string[]) { return new Uri(path.join(base.fsPath, ...parts)) }
}
/** Load compiled modules with the same injected host; no global require patch or real VS Code dependency. */
function load<T>(relative: string, api: object, overrides: Record<string, unknown> = {}): T {
    const cache = new Map<string, { exports: unknown }>()
    const visit = (file: string): unknown => {
        const resolved = require.resolve(file)
        const known = cache.get(resolved)
        if (known) return known.exports
        if (resolved.endsWith('.json')) return require(resolved)
        const module = { exports: {} }
        cache.set(resolved, module)
        vm.runInNewContext(readFileSync(resolved, 'utf8'), {
            module, exports: module.exports, Buffer, process, AbortController, AbortSignal, setTimeout, clearTimeout, URL, console,
            require: (id: string) => {
                if (id === 'vscode') return api
                for (const [suffix, value] of Object.entries(overrides)) if (id.endsWith(suffix)) return value
                return id.startsWith('.') ? visit(path.resolve(path.dirname(resolved), id)) : require(id)
            },
        }, { filename: resolved })
        return module.exports
    }
    return visit(path.join(__dirname, relative)) as T
}
function customizerFixture() {
    const service = new CustomizerService()
    let document = { uri: Uri.file('/workspace/a.scad'), isClosed: false, languageId: 'openscad', getText: () => 'width=10; // [0:5:100]\nsize=[1,2,3];\nshape="round"; // [round,square]\nlabel="A";' }
    const api = {
        EventEmitter: Emitter, Uri, TabInputCustom: class {},
        window: { tabGroups: { activeTabGroup: {}, onDidChangeTabs: () => disposable }, get activeTextEditor() { return { document } }, onDidChangeActiveTextEditor: () => disposable },
        workspace: { get textDocuments() { return [document] }, onDidChangeTextDocument: () => disposable, onDidOpenTextDocument: () => disposable, onDidCloseTextDocument: () => disposable },
    }
    const module = load<typeof import('../features/sidebar/CustomizerDomainService')>('../features/sidebar/CustomizerDomainService.js', api, {
        '/WorkspacePaths': { assertWorkspacePath: async () => {} },
        '/notifications': { confirmCapabilityAction: async () => false },
    })
    const domain = new module.CustomizerDomainService(service)
    return { service, domain, api, switchTarget() { document = { ...document, uri: Uri.file('/workspace/b.scad') }; domain.loadTarget() } }
}

test('Customizer has full schema with no panel, atomic validation, shared Preview events and stale guards', () => {
    const { service, domain, switchTarget } = customizerFixture()
    const initial = domain.snapshot()
    assert.equal(initial.parameters.length, 4)
    assert.equal(initial.parameters[0].range?.step, 5)
    assert.deepEqual(JSON.parse(JSON.stringify(initial.parameters[1].defaultValue)), [1, 2, 3])
    assert.throws(() => domain.setValues(initial.target!, initial.revision, { label: 'Valid', width: 11 }), /steps/)
    assert.deepEqual(service.getOverrides(initial.target!), {})
    let previews = 0
    service.onDidChangeValues(() => previews++)
    const after = domain.setValues(initial.target!, initial.revision, { width: 25, label: 'New' })
    assert.equal(previews, 1)
    assert.ok(service.getArguments().includes('width=25'))
    assert.equal(after.parameters[0].value, 25)
    assert.throws(() => domain.reset(initial.target!, initial.revision), /changed/)
    switchTarget()
    assert.throws(() => domain.setValues(initial.target!, after.revision, { width: 50 }), /target/)
    assert.deepEqual(service.getOverrides('file:///workspace/b.scad'), {})
    domain.dispose()
})

test('Customizer preset deletion cannot be approved by model input and leaves state unchanged', async () => {
    const { domain } = customizerFixture()
    const snapshot = domain.snapshot()
    await assert.rejects(domain.preset(snapshot.target!, snapshot.revision, 'delete', 'Important'), /cancelled/)
    assert.equal(domain.snapshot().revision, snapshot.revision)
    domain.dispose()
})

test('Production denies every Dev cache read/mutation path when called directly', async () => {
    const module = load<typeof import('../features/development/DeveloperCacheController')>('../features/development/DeveloperCacheController.js', { EventEmitter: Emitter, ExtensionMode: { Development: 2 } }, { '/notifications': { confirmCapabilityAction: async () => true } })
    const cache = new module.DeveloperCacheController({ extensionMode: 1 } as vscode.ExtensionContext, async () => {})
    assert.equal(cache.enabled, false)
    for (const call of [() => cache.getState(), () => cache.listSafe(), () => cache.inspectSafe('id'), () => cache.clearSafe({ all: true }), () => cache.handle({ action: 'development.clearAllCaches' })]) await assert.rejects(call, /development mode/)
    cache.dispose()
})

test('Workspace paths reject outside files and canonical symlink escapes; allow workspace files and new sidecars', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-capability-path-'))
    try {
        const workspace = path.join(root, 'workspace')
        const external = path.join(root, 'external')
        await mkdir(workspace); await mkdir(external)
        await writeFile(path.join(workspace, 'valid.json'), '{}')
        await writeFile(path.join(external, 'secret.json'), '{}')
        await symlink(external, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
        const { assertWorkspacePath } = load<typeof import('../platform/WorkspacePaths')>('../platform/WorkspacePaths.js', { workspace: { workspaceFolders: [{ uri: Uri.file(workspace) }] } })
        await assertWorkspacePath(Uri.file(path.join(workspace, 'valid.json')) as unknown as vscode.Uri)
        await assertWorkspacePath(Uri.file(path.join(workspace, 'new.json')) as unknown as vscode.Uri, true)
        for (const file of [path.join(external, 'secret.json'), path.join(workspace, 'escape', 'secret.json')]) await assert.rejects(assertWorkspacePath(Uri.file(file) as unknown as vscode.Uri), /outside/)
    } finally { await rm(root, { force: true, recursive: true }) }
})

test('LM adapter registers side-effect confirmation and bridges cancellation to structured failures', async () => {
    const registry = new CapabilityRegistry()
    registry.bind('runtime.remove', { available: () => ({ enabled: true }), invoke: (_, ctx) => { assert.equal(ctx.actor, 'agent'); throw new CapabilityError('CANCELLED', 'Human declined') } })
    const dispatcher = new CapabilityDispatcher(registry)
    const { AgentToolAdapter } = load<typeof import('../features/agents/AgentToolAdapter')>('../features/agents/AgentToolAdapter.js', {
        LanguageModelToolResult: class { constructor(readonly content: unknown[]) {} },
        LanguageModelTextPart: class { constructor(readonly value: string) {} },
    })
    const sourceAdapter = new AgentToolAdapter(capabilityCatalog.find((d) => d.id === 'customizer.sourceApply')!, dispatcher)
    assert.equal(sourceAdapter.prepareInvocation({ input: { mode: 'plan', uri: 'file:///workspace/model.scad' } }).confirmationMessages, undefined)
    assert.ok(sourceAdapter.prepareInvocation({ input: { mode: 'commit', planId: 'opaque' } }).confirmationMessages)
    const adapter = new AgentToolAdapter(capabilityCatalog.find((d) => d.id === 'runtime.remove')!, dispatcher)
    assert.match(String(adapter.prepareInvocation({ input: { id: 'managed-runtime' } }).confirmationMessages?.message), /managed-runtime/)
    const result = await adapter.invoke({ input: { id: 'managed-runtime' }, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>, { onCancellationRequested: () => disposable, isCancellationRequested: false } as unknown as vscode.CancellationToken)
    const output = JSON.parse((result.content[0] as vscode.LanguageModelTextPart).value)
    assert.equal(output.ok, false)
    assert.equal(output.error.code, 'CANCELLED')
})

import { fixture } from './libraries/helpers'

test('Library GUI and Agent share exact-version transactions, explicit projects, verification and human-confirmed two-phase cleanup', async () => {
    const f = await fixture()
    let approved = false
    let confirmations = 0
    const api = {
        EventEmitter: Emitter, Uri,
        ProgressLocation: { Notification: 1 },
        window: { onDidChangeActiveTextEditor: () => disposable, withProgress: async (_: unknown, task: (progress: { report(): void }, token: { onCancellationRequested(): typeof disposable }) => unknown) => task({ report() {} }, { onCancellationRequested: () => disposable }) },
        workspace: { isTrusted: true, workspaceFolders: [{ uri: Uri.file(f.project) }], onDidChangeWorkspaceFolders: () => disposable },
    }
    const module = load<typeof import('../features/libraries/LibraryPanelController')>('../features/libraries/LibraryPanelController.js', api, {
        '/notifications': { confirmLibraryCleanup: async () => { confirmations++; return approved } },
    })
    const controller = new module.LibraryPanelController(f.manager, async () => { confirmations++; return approved })
    try {
        await controller.handle({ action: 'libraries.search', query: 'fixture' })
        await controller.execute({ action: 'libraries.install', project: f.project, id: 'fixture', version: 'v1' }, { actor: 'agent' })
        assert.match(JSON.stringify(await controller.projectState(f.project)), /v1/)
        const current = await controller.getState()
        assert.equal(current.global.length, 1)
        const agentRows = await controller.search('fixture')
        assert.deepEqual(JSON.parse(JSON.stringify(agentRows)), JSON.parse(JSON.stringify(current.registry)), 'GUI and Agent must share cached and installability metadata')
        assert.equal(agentRows[0].versions[0].cached, true)
        assert.equal((await controller.search('', 'fixture'))[0].id, 'fixture')
        await controller.execute({ action: 'libraries.verify', key: current.global[0].key }, { actor: 'agent' })
        await assert.rejects(controller.execute({ action: 'libraries.install', project: f.root, id: 'fixture', version: 'v2' }, { actor: 'agent' }), /workspace project/)
        assert.equal((await f.store.list()).length, 1)
        const protectedPlan = await controller.planCleanup({ mode: 'unused' })
        assert.equal(protectedPlan.candidates.length, 0)
        assert.equal(protectedPlan.protectedCount, 1)
        await controller.execute({ action: 'libraries.remove', project: f.project, id: 'fixture' }, { actor: 'agent' })
        const plan = await controller.planCleanup({ mode: 'unused' })
        assert.equal(plan.candidates.length, 1)
        assert.equal((await f.store.list()).length, 1, 'Planning must not delete')
        await assert.rejects(controller.executeCleanup(plan.id), /cancelled/)
        assert.equal(confirmations, 1)
        assert.equal((await f.store.list()).length, 1)
        await assert.rejects(controller.executeCleanup(plan.id), /expired/)
        approved = true
        const approvedPlan = await controller.planCleanup({ mode: 'unused' })
        assert.equal((await controller.executeCleanup(approvedPlan.id)).removed, 1)
        assert.equal((await f.store.list()).length, 0)
        assert.equal(confirmations, 2)
        await assert.rejects(controller.execute({ action: 'libraries.verify', key: current.global[0].key }, { actor: 'agent' }), /no longer exists/)
        api.workspace.isTrusted = false
        await assert.rejects(controller.execute({ action: 'libraries.restore', project: f.project }, { actor: 'agent' }), /Trust/)
    } finally { controller.dispose(); await f.cleanup() }
})

import type { CapabilityServices } from '../features/agents/registerCapabilities'

test('all catalog handlers execute without panels and preserve exact service arguments and safe outputs', async () => {
    const calls: Array<{ name: string; input?: unknown }> = []
    const record = (name: string, output: unknown = {}) => async (input?: unknown) => { calls.push({ name, input }); return output }
    let runtimeAbort: AbortController | undefined
    let libraryAbort: AbortController | undefined
    const runtimeState = { recommendedBuildId: 1, installedBuildIds: [1], activeId: 'runtime', runtimes: [{ id: 'runtime', version: 'test', command: { executable: '/installed/openscad', argsPrefix: [] as string[] }, source: 'managed' }], builds: [{ id: 1, channel: 'Stable' }], busy: false, buildsLoaded: true, message: '' }
    const services = {
        runtime: { cancel: () => { if (!runtimeAbort) return false; runtimeAbort.abort(); return true }, refreshInstalled: record('refreshInstalled'), onDidChange: () => disposable, getState: () => runtimeState, getActiveRuntime: () => runtimeState.runtimes.find((r) => r.id === runtimeState.activeId), whenReady: async () => {}, loadBuilds: record('loadBuilds'), refresh: record('refresh'), installBuild: record('installBuild'), installArchivePath: record('installArchivePath'), addExecutable: record('addExecutable'), select: record('select'), deleteRuntime: async (id: string) => { calls.push({ name: 'deleteRuntime', input: id }); runtimeState.runtimes = runtimeState.runtimes.filter((r) => r.id !== id); runtimeState.activeId = '' } },
        libraries: { activity: () => ({ busy: !!libraryAbort, cancellable: !!libraryAbort, message: libraryAbort ? 'Installing from GUI' : '', error: '', trusted: true }), search: record('search', []), cancel: () => { if (!libraryAbort) return false; libraryAbort.abort(); return true }, isBusy: () => false, onDidChange: () => disposable, getState: async () => ({ registry: [], global: [], globalIssues: [], registryLoaded: true }), projects: async () => ['/workspace'], projectState: record('projectState', { dependencies: [] }), loadRegistry: record('loadRegistry'), execute: record('library.execute'), planCleanup: record('planCleanup', { id: 'plan' }), executeCleanup: record('executeCleanup', { removed: 1 }), manager: { registry: { search: record('search', []), getLibrary: record('getLibrary', { id: 'fixture', versions: [] }) } } },
        customizerSource: { analyze: record('sourceAnalyze'), apply: record('sourceApply'), validate: record('sourceValidate') },
        customizer: { isBusy: () => false, snapshot: () => ({ target: 'file:///workspace/model.scad', revision: 1 }), setValues: record('setValues'), reset: record('reset'), preset: record('preset') },
        github: { refresh: record('github.refresh'), connect: record('github.connect'), getState: () => ({ mode: 'anonymous', busy: false, message: 'Authentication unavailable: Bearer hidden-value', accessToken: 'must-not-leak' }) },
        development: { isBusy: () => false, enabled: true, listSafe: record('listSafe'), inspectSafe: record('inspectSafe'), clearSafe: record('clearSafe') },
    } as unknown as CapabilityServices
    const module = load<typeof import('../features/agents/registerCapabilities')>('../features/agents/registerCapabilities.js', { Uri, workspace: { isTrusted: true } }, {
        '/CapabilityRegistry': { CapabilityRegistry, capabilityCatalog }, '/CapabilityDispatcher': { CapabilityDispatcher }, '/CapabilityTypes': { CapabilityError },
    })
    const capabilities = module.registerCapabilities(services)
    try {
        const inputs: Record<string, Record<string, unknown>> = {
            'runtime.installBuild': { id: 1 }, 'runtime.installArchive': { path: '/host/archive.zip' }, 'runtime.addExecutable': { path: '/host/openscad' }, 'runtime.select': { id: 'runtime' }, 'runtime.remove': { id: 'runtime' },
            'customizer.sourceAnalyze': { uri: 'file:///workspace/model.scad' }, 'customizer.sourceValidate': { uri: 'file:///workspace/model.scad' }, 'customizer.sourceApply': { mode: 'commit', planId: 'plan' },
            'customizer.set': { target: 'file:///workspace/model.scad', revision: 1, values: { width: 25 } }, 'customizer.reset': { target: 'file:///workspace/model.scad', revision: 1 },
            'libraries.install': { project: '/workspace', id: 'fixture', version: 'v1' }, 'libraries.remove': { project: '/workspace', id: 'fixture' }, 'libraries.restore': { project: '/workspace' }, 'libraries.projectState': { project: '/workspace' }, 'libraries.repair': { key: 'cache' }, 'libraries.cleanupExecute': { planId: 'plan' },
            'development.inspectCache': { id: 'cache' }, 'development.clearCaches': { all: true },
        }
        for (const definition of capabilityCatalog) {
            let input = inputs[definition.id] ?? {}
            if (definition.service.startsWith('CustomizerDomainService.preset:')) input = { target: 'file:///workspace/model.scad', revision: 1, ...(['customizer.importPresets', 'customizer.exportPresets'].includes(definition.id) ? { uri: 'file:///workspace/preset.json' } : { name: 'Preset' }) }
            if (definition.id === 'operation.cancel') input = { id: (capabilities.dispatcher.operations.status() as { operations: Array<{ id: string }> }).operations[0].id }
            const result = await capabilities.dispatcher.invoke(definition.id, input, { actor: 'agent' })
            assert.equal(result.ok, true, `${definition.id}: ${JSON.stringify(result)}`)
            assert.doesNotMatch(JSON.stringify(result), /must-not-leak|accessToken|hidden-value/)
        }
        runtimeState.activeId = 'runtime'
        runtimeState.runtimes.push({ id: 'runtime', version: 'test', command: { executable: '/installed/openscad', argsPrefix: [] }, source: 'managed' })
        runtimeState.runtimes.unshift(...Array.from({ length: 25 }, (_, index) => ({ id: `other-${index}`, version: `2026.${index}`, command: { executable: `/installed/${index}/openscad`, argsPrefix: [] }, source: 'PATH' })))
        const beforeOnline = calls.length
        const online = await capabilities.dispatcher.invoke('runtime.builds', guiInput('panels/runtime', 'refreshBuilds', 'runtime.builds'), { actor: 'agent' })
        assert.equal(online.ok, true)
        assert.ok(calls.slice(beforeOnline).some((c) => c.name === 'loadBuilds' && c.input === true), 'Available Refresh must force online reload')
        if (online.ok) assert.equal((online.data as { builds: { items: Array<{ installed: boolean }> } }).builds.items[0].installed, true)
        const outsideCatalogPage = await capabilities.dispatcher.invoke('runtime.builds', { offset: 100, limit: 1 }, { actor: 'agent' })
        assert.equal(outsideCatalogPage.ok, true)
        if (outsideCatalogPage.ok) {
            const data = outsideCatalogPage.data as { recommendedBuild: { id: number }; builds: { items: unknown[] } }
            assert.equal(data.builds.items.length, 0)
            assert.equal(data.recommendedBuild.id, 1)
        }
        await capabilities.dispatcher.invoke('runtime.refresh', guiInput('panels/runtime', 'refreshInstalled', 'runtime.refresh'), { actor: 'agent' })
        assert.ok(calls.some((c) => c.name === 'refreshInstalled'), 'Installed Refresh must use the GUI silent refresh service')
        runtimeState.installedBuildIds = []
        const missingInstall = await capabilities.dispatcher.invoke('runtime.installBuild', { id: 1 }, { actor: 'agent' })
        assert.equal(missingInstall.ok, false)
        if (!missingInstall.ok) assert.equal(missingInstall.error.code, 'POSTCONDITION_FAILED')
        runtimeState.installedBuildIds = [1]
        const realRemove = services.runtime.deleteRuntime
        services.runtime.deleteRuntime = async () => {}
        const stillInstalled = await capabilities.dispatcher.invoke('runtime.remove', { id: 'runtime' }, { actor: 'agent' })
        assert.equal(stillInstalled.ok, false)
        if (!stillInstalled.ok) assert.equal(stillInstalled.error.code, 'POSTCONDITION_FAILED')
        services.runtime.deleteRuntime = realRemove
        runtimeAbort = new AbortController(); libraryAbort = new AbortController()
        for (const domain of ['runtime', 'libraries']) {
            const input = domain === 'runtime' ? guiInput('runtime cancellation', 'cancel', 'operation.cancel') : guiInput('libraries', 'libraries.cancel', 'operation.cancel')
            const cancelled = await capabilities.dispatcher.invoke('operation.cancel', input, { actor: 'agent' })
            assert.equal(cancelled.ok, true)
            if (cancelled.ok) assert.equal((cancelled.data as { cancellationRequested: boolean }).cancellationRequested, true)
        }
        const duringGuiTask = await capabilities.dispatcher.invoke('libraries.globalState', {}, { actor: 'agent' })
        assert.equal(duringGuiTask.ok, true)
        if (duringGuiTask.ok) assert.equal((duringGuiTask.data as { cancellable: boolean; busy: boolean }).cancellable, true)
        assert.equal(runtimeAbort.signal.aborted, true)
        assert.equal(libraryAbort.signal.aborted, true)
        runtimeAbort = undefined; libraryAbort = undefined
        const idle = await capabilities.dispatcher.invoke('operation.cancel', { domain: 'runtime' }, { actor: 'agent' })
        if (idle.ok) assert.equal((idle.data as { status: string }).status, 'noCancellableTask')
        const firstPage = await capabilities.dispatcher.invoke('runtime.state', { limit: 1 }, { actor: 'agent' })
        assert.equal(firstPage.ok, true)
        if (firstPage.ok) {
            const { state } = firstPage.data as { state: { activeRuntime: { id: string; version: string; command: { executable: string } }; runtimes: { total: number; items: Array<{ id: string }>; hasMore: boolean; nextOffset: number } } }
            assert.equal(state.activeRuntime.id, 'runtime')
            assert.equal(state.activeRuntime.version, 'test')
            assert.equal(state.activeRuntime.command.executable, '/installed/openscad')
            assert.equal(state.runtimes.items[0].id, 'other-0')
            assert.equal(state.runtimes.total, 26)
            assert.equal(state.runtimes.hasMore, true)
            assert.equal(state.runtimes.nextOffset, 1)
        }
        const lastPage = await capabilities.dispatcher.invoke('runtime.state', { offset: 25, limit: 1 }, { actor: 'agent' })
        assert.equal(lastPage.ok, true)
        if (lastPage.ok) assert.equal((lastPage.data as { state: { runtimes: { nextOffset: null } } }).state.runtimes.nextOffset, null)
        runtimeState.activeId = 'missing-configured-selection'
        const noSelection = await capabilities.dispatcher.invoke('runtime.state', {}, { actor: 'agent' })
        if (noSelection.ok) assert.equal((noSelection.data as { state: { activeRuntime: null } }).state.activeRuntime, null)
        assert.ok(calls.some((call) => call.name === 'library.execute' && (call.input as { project: string; version: string }).project === '/workspace' && (call.input as { version: string }).version === 'v1'))
        assert.ok(calls.some((call) => call.name === 'installBuild' && call.input === 1))
        assert.ok(calls.some((call) => call.name === 'installArchivePath' && call.input === '/host/archive.zip'))
    } finally { capabilities.dispose() }
})

test('Development cache inspection is bounded/redacted; confirmation, stale state and partial clear failures preserve managed artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-dev-cache-'))
    const values = new Map<string, unknown>([['secretField', { accessToken: 'hidden-token', useful: 'value' }], ['apiKey', 'opaque-unrecognized-credential'], ['failure', { count: 1 }]])
    let approve = false
    let changeDuringApproval = false
    let events = 0
    try {
        await mkdir(path.join(root, 'cache'))
        await mkdir(path.join(root, 'runtimes'))
        await writeFile(path.join(root, 'cache', 'list.json'), '{}')
        await writeFile(path.join(root, 'runtimes', 'keep'), 'managed-resource')
        const memento = { keys: () => [...values.keys()], get: (key: string) => values.get(key), update: async (key: string, value: unknown) => { if (key === 'failure') throw new Error('disk denied'); if (value === undefined) values.delete(key); else values.set(key, value) } }
        const api = { EventEmitter: Emitter, Uri, ExtensionMode: { Development: 2 }, workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) } }
        const module = load<typeof import('../features/development/DeveloperCacheController')>('../features/development/DeveloperCacheController.js', api, {
            '/notifications': {}, '/cache/CacheRegistry': { memoryCaches: { entries: () => [] } },
        })
        const cache = new module.DeveloperCacheController({ extensionMode: 2, globalStorageUri: Uri.file(root), globalState: memento, workspaceState: { keys: () => [] } } as unknown as vscode.ExtensionContext, async () => {}, undefined, async () => { if (changeDuringApproval) values.set('secretField', { changed: true }); return approve })
        cache.onDidChange(() => events++)
        const metadata = await cache.listSafe(0, 1)
        assert.equal(metadata.entries.length, 1)
        assert.doesNotMatch(JSON.stringify(metadata), /hidden-token|useful|accessToken/)
        const inspected = await cache.inspectSafe('globalState:secretField')
        assert.doesNotMatch(JSON.stringify(inspected), /hidden-token/)
        assert.match(JSON.stringify(inspected), /REDACTED/)
        assert.doesNotMatch(JSON.stringify(await cache.inspectSafe('globalState:apiKey')), /opaque-unrecognized-credential/)
        await assert.rejects(cache.clearSafe({ id: 'globalState:secretField' }), /cancelled/)
        assert.ok(values.has('secretField'))
        approve = true
        changeDuringApproval = true
        await assert.rejects(cache.clearSafe({ id: 'globalState:secretField' }), /changed during confirmation/)
        changeDuringApproval = false
        await assert.rejects(cache.clearSafe({ all: true }), /disk denied/)
        assert.equal(values.has('secretField'), false)
        assert.equal(values.has('failure'), true)
        assert.equal(readFileSync(path.join(root, 'runtimes', 'keep'), 'utf8'), 'managed-resource')
        assert.ok(events >= 3, 'GUI subscribers receive terminal changes, including partial failure')
        cache.dispose()
    } finally { await rm(root, { force: true, recursive: true }) }
})

test('preset import rejects an asynchronous target switch with TARGET_CHANGED before rebinding files', async () => {
    const f = customizerFixture()
    let finish!: (value: Uint8Array) => void
    Object.assign(f.api.workspace, { fs: { readFile: () => new Promise<Uint8Array>((resolve) => { finish = resolve }) } })
    const state = f.domain.snapshot()
    const pending = f.domain.preset(state.target!, state.revision, 'import', undefined, Uri.file('/workspace/presets.json') as unknown as vscode.Uri)
    f.switchTarget()
    finish(Buffer.from('{"fileFormatVersion":"1","parameterSets":{"Test":{"width":"25"}}}'))
    await assert.rejects(pending, (error: unknown) => (error as { code?: string }).code === 'TARGET_CHANGED')
    assert.equal(f.domain.snapshot().presets.path, undefined)
    f.domain.dispose()
})

async function sourceFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scad-source-'))
    const file = path.join(root, 'model.scad')
    await writeFile(file, 'width=40;\n')
    let text = 'width=40;\n'
    let now = 1000
    const document = {
        uri: Uri.file(file), version: 1, isClosed: false, isDirty: false,
        getText: () => text,
        positionAt: (offset: number) => ({ offset }),
    }
    class Range { constructor(readonly start: { offset: number }, readonly end: { offset: number }) {} }
    class WorkspaceEdit {
        edits: Array<{ uri: Uri; range: Range; text: string }> = []
        replace(uri: Uri, range: Range, text: string) { this.edits.push({ uri, range, text }) }
    }
    const close = new Emitter()
    let reject = false, interfere = false
    let applied = 0
    const api = { Uri, Range, WorkspaceEdit, workspace: {
        isTrusted: true, workspaceFolders: [{ uri: Uri.file(root) }],
        getWorkspaceFolder: (uri: Uri) => uri.fsPath.startsWith(root + path.sep) ? { uri: Uri.file(root) } : undefined,
        onDidCloseTextDocument: close.event, onDidChangeTextDocument: () => disposable,
        openTextDocument: async () => document,
        applyEdit: async (edit: WorkspaceEdit) => {
            if (reject) return false
            applied++
            for (const e of [...edit.edits].sort((a, b) => b.range.start.offset - a.range.start.offset)) {
                assert.equal(e.uri.toString(), document.uri.toString())
                text = text.slice(0, e.range.start.offset) + e.text + text.slice(e.range.end.offset)
            }
            if (interfere) text = 'width=200;\n'
            document.version++; document.isDirty = true
            return true
        },
    } }
    const module = load<typeof import('../features/sidebar/CustomizerSourceDomainService')>('../features/sidebar/CustomizerSourceDomainService.js', api)
    const domain = new module.CustomizerSourceDomainService(() => now)
    const uri = document.uri.toString()
    const plan = async () => {
        const { identity } = await domain.analyze(uri)
        return domain.apply({ mode: 'plan', uri, identity: { version: identity.version, sha256: identity.sha256 }, edits: [{ kind: 'annotateExisting', name: 'width', widget: 'slider', range: { min: 10, max: 100, step: 5 } }] }) as Promise<{ planId: string }>
    }
    return { root, file, uri, domain, document, api, plan, get text() { return text }, get applied() { return applied }, change(value: string, version = true) { text = value; if (version) document.version++ }, expire() { now += 120001 }, reject() { reject = true }, interfere() { interfere = true }, close() { document.isClosed = true; close.fire(document) }, async dispose() { domain.dispose(); await rm(root, { recursive: true, force: true }) } }
}

test('source plan/commit reads unsaved buffers, never writes disk and consumes plans once', async () => {
    const f = await sourceFixture()
    try {
        f.change('// Unsaved\nwidth=40;\n')
        const analysis = await f.domain.analyze(f.uri)
        assert.equal(analysis.parameters[0].description, 'Unsaved')
        const plan = await f.plan()
        assert.equal(f.applied, 0)
        const committed = await f.domain.apply({ mode: 'commit', planId: plan.planId }) as { semanticPass: boolean; savedToDisk: boolean }
        assert.equal(committed.semanticPass, true)
        assert.equal(committed.savedToDisk, false)
        assert.equal(readFileSync(f.file, 'utf8'), 'width=40;\n')
        assert.match(f.text, /\[10:5:100\]/)
        assert.equal((await f.domain.validate(f.uri, [{ name: 'width', widget: 'slider' }])).semanticPass, true)
        await assert.rejects(f.domain.apply({ mode: 'commit', planId: plan.planId }), (e: unknown) => (e as CapabilityError).code === 'PLAN_EXPIRED')
    } finally { await f.dispose() }
})
test('source CAS rejects version, hash-only changes, closed targets, expiry, trust loss and cancellation', async () => {
    for (const scenario of ['version', 'hash', 'close', 'expiry', 'trust', 'cancel']) {
        const f = await sourceFixture()
        try {
            const plan = await f.plan()
            if (scenario === 'version') f.change(f.text)
            if (scenario === 'hash') f.change('width=50;\n', false)
            if (scenario === 'close') f.close()
            if (scenario === 'expiry') f.expire()
            if (scenario === 'trust') f.api.workspace.isTrusted = false
            const abort = new AbortController()
            if (scenario === 'cancel') abort.abort()
            await assert.rejects(f.domain.apply({ mode: 'commit', planId: plan.planId }, { actor: 'agent', signal: abort.signal }), scenario)
            assert.equal(f.applied, 0, scenario)
        } finally { await f.dispose() }
    }
})
test('source tools independently reject outside paths and symlink escapes, with read-only analysis in untrusted workspaces', async () => {
    const f = await sourceFixture()
    const outside = await mkdtemp(path.join(os.tmpdir(), 'scad-source-outside-'))
    try {
        const other = path.join(outside, 'other.scad')
        await writeFile(other, 'a=1;')
        await symlink(other, path.join(f.root, 'escape.scad'))
        await symlink(outside, path.join(f.root, 'escape-dir'))
        for (const uri of [Uri.file(other), Uri.file(path.join(f.root, 'escape.scad')), Uri.file(path.join(f.root, 'escape-dir', 'other.scad'))]) await assert.rejects(f.domain.analyze(uri.toString()), (e: unknown) => (e as CapabilityError).code === 'OUTSIDE_WORKSPACE')
        await assert.rejects(f.domain.analyze('https://example.com/model.scad'), (e: unknown) => (e as CapabilityError).code === 'INVALID_URI')
        f.api.workspace.isTrusted = false
        assert.equal((await f.domain.analyze(f.uri)).parameters.length, 1)
        await assert.rejects(f.plan(), (e: unknown) => (e as CapabilityError).code === 'UNTRUSTED_WORKSPACE')
    } finally { await f.dispose(); await rm(outside, { recursive: true, force: true }) }
})
test('source commit reports rejected WorkspaceEdit and real postcondition failure without overwriting concurrent text', async () => {
    for (const scenario of ['rejected', 'interference']) {
        const f = await sourceFixture()
        try {
            const plan = await f.plan()
            if (scenario === 'rejected') {
                f.reject()
                await assert.rejects(f.domain.apply({ mode: 'commit', planId: plan.planId }), (e: unknown) => (e as CapabilityError).code === 'POSTCONDITION_FAILED')
                assert.equal(f.text, 'width=40;\n')
            } else {
                f.interfere()
                const result = await f.domain.apply({ mode: 'commit', planId: plan.planId }) as { applied: boolean; semanticPass: boolean; error: { code: string } }
                assert.equal(result.applied, true)
                assert.equal(result.semanticPass, false)
                assert.equal(result.error.code, 'POSTCONDITION_FAILED')
                assert.equal(f.text, 'width=200;\n')
            }
        } finally { await f.dispose() }
    }
})

test('Customizer Quick Fixes use the semantic planner for invalid steps, explicit range prose, widget hints and groups', () => {
    class Range { constructor(readonly start: unknown, readonly end: unknown) {} }
    class WorkspaceEdit { edits: unknown[] = []; replace(uri: unknown, range: unknown, text: string) { this.edits.push({ uri, range, text }) } }
    class CodeAction { edit?: WorkspaceEdit; constructor(readonly title: string, readonly kind: unknown) {} }
    const api = { Range, WorkspaceEdit, CodeAction, CodeActionKind: { QuickFix: 'quickfix', RefactorRewrite: 'refactor.rewrite' }, workspace: { isTrusted: true, getConfiguration: () => ({ get: () => true }) } }
    const module = load<typeof import('../features/language/CustomizerCodeActions')>('../features/language/CustomizerCodeActions.js', api)
    for (const [source, title] of [
        ['width=40; // [10:0:100]\n', 'Customizer: remove invalid explicit step'],
        ['width=40; // range: 10..100 step 5\n', 'Customizer: convert explicit range comment to slider hint'],
        ['width=40;\n', 'Customizer: make numeric step explicit'],
        ['width=40;\n', 'Customizer: place parameter in Global group'],
    ]) {
        const document = { uri: Uri.file('/workspace/model.scad'), getText: () => source, positionAt: (offset: number) => ({ line: 0, character: offset }) }
        const actions = new module.CustomizerCodeActions().provideCodeActions(document as unknown as vscode.TextDocument, { start: { line: 0 }, end: { line: 0 } } as vscode.Range)
        assert.ok(actions.some((a) => a.title === title && a.edit), title)
        assert.equal(String(actions.find((a) => a.title === title)!.kind), title.includes('remove invalid') ? 'quickfix' : 'refactor.rewrite')
    }
    api.workspace.isTrusted = false
    assert.deepEqual(JSON.parse(JSON.stringify(new module.CustomizerCodeActions().provideCodeActions({ uri: Uri.file('/workspace/model.scad') } as unknown as vscode.TextDocument, {} as vscode.Range))), [])
})


test('the shared Library cancel service aborts a GUI-started installation and clears its cancellable state', async () => {
    const f = await fixture()
    const disposable = { dispose() {} }
    const api = {
        EventEmitter: Emitter, Uri, ProgressLocation: { Notification: 1 },
        window: { onDidChangeActiveTextEditor: () => disposable, withProgress: async (_: unknown, task: (progress: { report(): void }, token: { onCancellationRequested(): typeof disposable }) => unknown) => task({ report() {} }, { onCancellationRequested: () => disposable }) },
        workspace: { isTrusted: true, workspaceFolders: [{ uri: Uri.file(f.project) }], onDidChangeWorkspaceFolders: () => disposable },
    }
    const module = load<typeof import('../features/libraries/LibraryPanelController')>('../features/libraries/LibraryPanelController.js', api)
    const controller = new module.LibraryPanelController(f.manager)
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    f.manager.install = async (_project, _id, _version, signal) => {
        await new Promise<void>((_, reject) => { signal!.addEventListener('abort', () => reject(new Error('Cancelled by shared Library service')), { once: true }); entered() })
    }
    try {
        await controller.getState()
        assert.equal(controller.cancel(), false)
        const task = controller.handle({ action: 'libraries.install', id: 'fixture', version: 'v1' })
        await ready
        assert.equal((await controller.getState()).cancellable, true)
        assert.equal(controller.cancel(), true)
        await task
        assert.equal(controller.isBusy(), false)
        assert.equal(controller.cancel(), false)
        assert.match((await controller.getState()).error, /Cancelled/)
    } finally { controller.dispose(); await f.cleanup() }
})

import { createHash } from 'node:crypto'
import { chmod, readFile } from 'node:fs/promises'
import * as tar from 'tar'
import { RuntimeManager } from '../core/runtime/RuntimeManager'
import { discover } from '../platform/runtime/discovery'
import * as releaseFunctions from '../platform/runtime/releases'

test('Runtime Agent lifecycle forces catalog refresh, downloads/probes a real archive, selects, confirms deletion and verifies disk/state', { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-agent-lifecycle-'))
    const packageName = `openscad-cli-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}`
    const source = path.join(root, 'source', packageName, 'bin')
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'openscad'), '#!/bin/sh\necho "OpenSCAD version 2026.11.TEST"\n')
    await chmod(path.join(source, 'openscad'), 0o755)
    const archive = path.join(root, 'openscad.tar.gz')
    await tar.c({ cwd: path.join(root, 'source'), file: archive, gzip: true }, [packageName])
    const bytes = await readFile(archive)
    const build = { id: 12345, release: '2026.11.TEST', tag: 'openscad-2026.11.TEST', channel: 'Test' as const, prerelease: true, publishedAt: '', name: `openscad-cli-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}.tar.gz`, size: bytes.length, downloadUrl: 'https://fixture.test/archive', checksumUrl: 'https://fixture.test/checksum' }
    let catalogReads = 0, downloads = 0, approve = false
    const config = new Map<string, unknown>()
    const state = new Map<string, unknown>()
    const subscriptions: vscode.Disposable[] = []
    const host = {
        EventEmitter: Emitter, Uri, ConfigurationTarget: { Global: 1 }, ProgressLocation: { Notification: 1 },
        workspace: { isTrusted: true, onDidGrantWorkspaceTrust: () => disposable, onDidChangeConfiguration: () => disposable, getConfiguration: () => ({ get: (key: string, fallback: unknown) => config.has(key) ? config.get(key) : fallback, update: async (key: string, value: unknown) => { config.set(key, value) } }) },
    }
    const module = load<typeof import('../features/runtime/RuntimeService')>('../features/runtime/RuntimeService.js', host, {
        '/CapabilityTypes': { CapabilityError },
        '/notifications': { notifications: { runtimeAvailable() {}, runtimeUnavailable() {} }, confirmCapabilityAction: async () => approve },
        '/releases': { ...releaseFunctions, detectRuntimeSystem: async () => ({ platform: process.platform, architecture: process.arch, name: '', version: '' }), fetchRuntimeBuilds: async () => { catalogReads++; return [build] }, fetchLatestRuntimeTag: async () => build.tag },
    })
    const manager = new RuntimeManager((options) => discover({ ...options, env: { PATH: '' }, home: root }, { collect: async () => ({ candidates: [], diagnostics: [] }) }))
    const runtime = module.createRuntimeService({ globalStorageUri: Uri.file(path.join(root, 'storage')), subscriptions, globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value) } } } as unknown as vscode.ExtensionContext,
        manager, async (url) => {
            if (url.endsWith('/checksum')) return new Response(`${createHash('sha256').update(bytes).digest('hex')}  ${build.name}\n`)
            assert.equal(url, build.downloadUrl); downloads++
            return new Response(bytes)
        }, { output: { appendLine() {} }, status: { text: '', tooltip: '' }, withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable } as unknown as vscode.CancellationToken) })
    const adapter = load<typeof import('../features/agents/registerCapabilities')>('../features/agents/registerCapabilities.js', host, { '/CapabilityRegistry': { CapabilityRegistry, capabilityCatalog }, '/CapabilityDispatcher': { CapabilityDispatcher }, '/CapabilityTypes': { CapabilityError } })
    const bound = adapter.registerCapabilities({ runtime, libraries: { onDidChange: () => disposable, isBusy: () => false }, customizer: { isBusy: () => false }, development: { enabled: false } } as unknown as CapabilityServices)
    const call = (id: string, input: object = {}) => bound.dispatcher.invoke(id, input, { actor: 'agent' })
    try {
        assert.equal((await call('runtime.state')).ok, true)
        assert.equal((await call('runtime.builds')).ok, true)
        assert.equal(catalogReads, 1)
        assert.equal((await call('runtime.builds')).ok, true)
        assert.equal(catalogReads, 1, 'A cached read must not be mislabeled as online refresh')
        assert.equal((await call('runtime.builds', { refresh: true })).ok, true)
        assert.equal(catalogReads, 2)
        const installed = await call('runtime.installBuild', { id: build.id })
        assert.equal(installed.ok, true, JSON.stringify(installed))
        assert.equal(downloads, 1)
        assert.ok(runtime.getState().installedBuildIds.includes(build.id))
        const candidate = runtime.getState().runtimes.find((r) => r.version === '2026.11.TEST')!
        assert.ok(candidate)
        assert.match(await readFile(candidate.command.executable, 'utf8'), /OpenSCAD version/)
        assert.equal((await call('runtime.select', { id: candidate.id })).ok, true)
        assert.equal(runtime.getActiveRuntime()?.command.executable, candidate.command.executable)
        const refused = await call('runtime.remove', { id: candidate.id })
        assert.equal(refused.ok, false)
        if (!refused.ok) assert.equal(refused.error.code, 'CANCELLED')
        assert.ok(await readFile(candidate.command.executable))
        approve = true
        const removed = await call('runtime.remove', { id: candidate.id })
        assert.equal(removed.ok, true, JSON.stringify(removed))
        await assert.rejects(readFile(candidate.command.executable), /ENOENT/)
        assert.equal(runtime.getState().runtimes.length, 0)
        assert.equal(runtime.getActiveRuntime(), undefined)
    } finally { bound.dispose(); subscriptions.forEach((s) => s.dispose()); await rm(root, { recursive: true, force: true }) }
})
