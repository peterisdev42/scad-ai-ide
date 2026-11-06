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
import { CapabilityDispatcher } from '../core/capabilities/CapabilityDispatcher'
import type * as vscode from 'vscode'

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
    static parse(value: string) { return new Uri(new URL(value).pathname) }
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
            module, exports: module.exports, Buffer, process, AbortController, setTimeout, clearTimeout, URL, console,
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

test('all 37 catalog handlers execute without panels and preserve exact service arguments and safe outputs', async () => {
    const calls: Array<{ name: string; input?: unknown }> = []
    const record = (name: string, output: unknown = {}) => async (input?: unknown) => { calls.push({ name, input }); return output }
    const runtimeState = { runtimes: [{ id: 'runtime', version: 'test' }], builds: [{ id: 1, channel: 'Stable' }], busy: false, buildsLoaded: true, message: '' }
    const services = {
        runtime: { onDidChange: () => disposable, getState: () => runtimeState, getActiveRuntime: () => ({ id: 'runtime' }), whenReady: async () => {}, loadBuilds: record('loadBuilds'), refresh: record('refresh'), installBuild: record('installBuild'), installArchivePath: record('installArchivePath'), addExecutable: record('addExecutable'), select: record('select'), deleteRuntime: record('deleteRuntime') },
        libraries: { isBusy: () => false, onDidChange: () => disposable, getState: async () => ({ registry: [], global: [], globalIssues: [], registryLoaded: true }), projects: async () => ['/workspace'], projectState: record('projectState', { dependencies: [] }), loadRegistry: record('loadRegistry'), execute: record('library.execute'), planCleanup: record('planCleanup', { id: 'plan' }), executeCleanup: record('executeCleanup', { removed: 1 }), manager: { registry: { search: record('search', []), getLibrary: record('getLibrary', { id: 'fixture', versions: [] }) } } },
        customizer: { isBusy: () => false, snapshot: () => ({ target: 'file:///workspace/model.scad', revision: 1 }), setValues: record('setValues'), reset: record('reset'), preset: record('preset') },
        github: { refresh: record('github.refresh'), connect: record('github.connect'), getState: () => ({ mode: 'anonymous', busy: false, accessToken: 'must-not-leak' }) },
        development: { isBusy: () => false, enabled: true, listSafe: record('listSafe'), inspectSafe: record('inspectSafe'), clearSafe: record('clearSafe') },
    } as unknown as CapabilityServices
    const module = load<typeof import('../features/agents/registerCapabilities')>('../features/agents/registerCapabilities.js', { Uri, workspace: { isTrusted: true } }, {
        '/CapabilityRegistry': { CapabilityRegistry, capabilityCatalog }, '/CapabilityDispatcher': { CapabilityDispatcher }, '/CapabilityTypes': { CapabilityError },
    })
    const capabilities = module.registerCapabilities(services)
    try {
        const inputs: Record<string, Record<string, unknown>> = {
            'runtime.installBuild': { id: 1 }, 'runtime.installArchive': { path: '/host/archive.zip' }, 'runtime.addExecutable': { path: '/host/openscad' }, 'runtime.select': { id: 'runtime' }, 'runtime.remove': { id: 'runtime' },
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
            assert.doesNotMatch(JSON.stringify(result), /must-not-leak|accessToken/)
        }
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
