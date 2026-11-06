import { highlightJson } from '../features/development/JsonHighlighter'
import { DeveloperCacheController } from '../features/development/DeveloperCacheController'
import { memoryCaches } from '../core/cache/CacheRegistry'
import * as assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as vscode from 'vscode'
import type { activate } from '../extension'
import { fixture, registry } from './libraries/helpers'
import { RegistryClient, registryCacheKey, REGISTRY_URL } from '../platform/libraries/RegistryClient'
import { ProjectDependencyManager } from '../platform/libraries/ProjectDependencyManager'
import { LibraryPanelController } from '../features/libraries/LibraryPanelController'

suite('Library Manager extension host', () => {
    test('Libraries opens the real three-page webview and rejects untrusted message shapes', async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
        await vscode.commands.executeCommand('scad-ai.libraries.open')
        const panel = api.panels.getPanel('libraries')
        assert.ok(panel)
        assert.equal(panel.options.retainContextWhenHidden, true)
        await vscode.commands.executeCommand('scad-ai.runtime.open')
        await vscode.commands.executeCommand('scad-ai.libraries.open')
        assert.equal(api.panels.getPanel('libraries'), panel, 'Switching pages reuses the retained Webview')
        assert.match(panel.webview.html, /libraries\.js/)
        const f = await fixture()
        const controller = new LibraryPanelController(f.manager)
        try {
            await controller.handle({ action: 'libraries.selectProject', project: path.join(f.root, 'outside') })
            assert.match((await controller.getState()).error, /Unknown workspace/)
            await controller.handle({ action: 'libraries.previewCleanup', key: '../outside' })
            assert.match((await controller.getState()).error, /no longer exists/)
            await controller.handle({ action: 'libraries.search', query: { unsafe: true } })
            assert.match((await controller.getState()).error, /Invalid search/)
            await controller.handle(null)
            assert.equal((await f.store.list()).length, 0)
        } finally {
            controller.dispose()
            panel.dispose()
            await f.cleanup()
        }
    })
    test('Registry publishes its local list before a pending request and refreshes it on each visit', async () => {
        const f = await fixture()
        const entries = new Map<string, unknown>([[registryCacheKey(), { version: 1, sourceUrl: REGISTRY_URL, registry: registry() }]])
        let respond!: (response: Response) => void
        let started!: () => void
        let requested = new Promise<void>((resolve) => {
            started = resolve
        })
        let requests = 0
        const client = new RegistryClient(
            f.store.root,
            async () => {
                requests++
                started()
                return new Promise((resolve) => {
                    respond = resolve
                })
            },
            undefined,
            {
                get: (key) => entries.get(key),
                update: async (key, value) => {
                    entries.set(key, value)
                },
            },
        )
        const manager = new ProjectDependencyManager(f.store, client, f.installer)
        const controller = new LibraryPanelController(manager)
        try {
            assert.equal((await controller.getState()).registry[0].description, 'A test fixture')
            let changes = 0
            const listener = controller.onDidChange(() => changes++)
            for (const tab of ['global', 'project']) {
                await controller.handle({ action: 'libraries.selectTab', tab })
                const local = await controller.getState()
                assert.equal(local.registryBusy, false)
                assert.equal(local.busy, false)
                assert.equal(local.registry.length, 1)
                assert.equal(requests, 0, 'Local tab entry must never fetch the Registry')
                await controller.refreshActiveTab()
                assert.equal(requests, 0, 'Reopening a local tab must also remain local')
            }
            assert.equal(changes, 4, 'Each entry/reopen requests one local state publication')
            listener.dispose()

            for (const description of ['First remote update', 'Second remote update']) {
                requested = new Promise<void>((resolve) => {
                    started = resolve
                })
                const loading = controller.handle({ action: 'libraries.refresh' })
                await requested
                const pending = await controller.getState()
                assert.equal(pending.busy, false)
                assert.equal(pending.registryBusy, true)
                assert.equal(pending.registryLoaded, true)
                assert.equal(pending.registry.length, 1)
                assert.notEqual(pending.registry[0].description, description)
                const concurrent = controller.handle({ action: 'libraries.refresh' })
                const next = registry()
                next.libraries[0].description = description
                respond(new Response(JSON.stringify(next)))
                await Promise.all([loading, concurrent])
                assert.equal((await controller.getState()).registry[0].description, description)
            }
            assert.equal(requests, 2)
        } finally {
            controller.dispose()
            await f.cleanup()
        }
    })
    test('Silent Registry refresh preserves cached rows, exposes failures and clears errors after recovery', async () => {
        const f = await fixture()
        let fail = true
        let requests = 0
        const cached = { version: 1, sourceUrl: REGISTRY_URL, registry: registry() }
        const client = new RegistryClient(
            f.store.root,
            async () => {
                requests++
                if (fail) throw new Error('Registry connection failed')
                return new Response(JSON.stringify(registry()))
            },
            undefined,
            { get: () => cached, update: async () => {} },
        )
        const controller = new LibraryPanelController(new ProjectDependencyManager(f.store, client, f.installer))
        try {
            await controller.loadRegistry()
            const offline = await controller.getState()
            assert.equal(offline.busy, false)
            assert.equal(offline.registryBusy, false)
            assert.equal(offline.registryLoaded, true)
            assert.equal(offline.registry.length, 1)
            assert.match(offline.registryError, /Registry connection failed/)
            await controller.handle({ action: 'libraries.search', query: 'unmatched' })
            assert.equal(requests, 1, 'Local search does not retry a failed network request')
            assert.equal((await controller.getState()).registry.length, 1, 'The webview receives the full local catalog for filtering')
            fail = false
            await controller.loadRegistry()
            assert.equal((await controller.getState()).registryError, '')
        } finally {
            controller.dispose()
            await f.cleanup()
        }
    })
    test('Real LSP resolves the same include name to distinct locked versions in two projects', async function () {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
        const f = await fixture()
        const other = path.join(f.root, 'Project B')
        await mkdir(other)
        try {
            await f.manager.install(f.project, 'fixture', 'v1')
            await f.manager.install(other, 'fixture', 'v2')
            const source = 'use <fixture-library/smoke.scad>;\ntest_shape();\n'
            const documents: vscode.TextDocument[] = []
            for (const project of [f.project, other]) {
                const file = path.join(project, 'main.scad')
                await writeFile(file, source)
                documents.push(await vscode.workspace.openTextDocument(file))
            }
            for (let i = 0; i < documents.length; i++) {
                await vscode.window.showTextDocument(documents[i])
                assert.equal((await api.libraries.getState()).selectedProject, i === 0 ? f.project : other, 'Current Project follows the active source document')
            }
            await api.language.restart()
            assert.ok(api.language.isRunning())
            for (let i = 0; i < documents.length; i++) {
                const document = documents[i]
                const deadline = Date.now() + 10000
                let targets: string[] = []
                do {
                    const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, new vscode.Position(1, 4))
                    targets = (definitions ?? []).map((location) => ('uri' in location ? location.uri : location.targetUri).fsPath)
                    if (targets.length) break
                    await new Promise((resolve) => setTimeout(resolve, 50))
                } while (Date.now() < deadline)
                assert.ok(targets.length, `No definition returned for project ${i}`)
                assert.ok(
                    targets.every((target) => !target.includes(i === 0 ? 'Project B' : '项目 A')),
                    JSON.stringify(targets),
                )
                const expected = f.store.directory('fixture', 'https://github.com/example/fixture', i === 0 ? 'a'.repeat(40) : 'b'.repeat(40))
                assert.ok(
                    targets.some((target) => target.startsWith(expected) || target.startsWith(i === 0 ? f.project : other)),
                    JSON.stringify(targets),
                )
            }
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors')
            await f.cleanup()
        }
    })
    test('Development cache tools reject production and test mode before reading storage', async () => {
        for (const extensionMode of [vscode.ExtensionMode.Production, vscode.ExtensionMode.Test]) {
            const controller = new DeveloperCacheController({ extensionMode } as vscode.ExtensionContext, async () => {})
            assert.equal(controller.enabled, false)
            await assert.rejects(controller.getState(), /development mode/)
            await assert.rejects(controller.handle({ action: 'development.clearAllCaches' }), /development mode/)
            await assert.rejects(controller.handle({ action: 'development.openGlobalFolder' }), /development mode/)
            await assert.rejects(controller.handle({ action: 'development.clearScopeCaches', scope: 'globalState' }), /development mode/)
            await assert.rejects(controller.handle({ action: 'development.openCacheEditor', id: 'globalState:x' }), /development mode/)
        }
    })
    test('Development cache tools enumerate and clear individual state, disk and memory fields', async () => {
        const f = await fixture()
        const invalidated: string[] = []
        const global = new Map<string, unknown>([['fixture.cache', { list: [1, 2] }]])
        const workspace = new Map<string, unknown>([['openscad.scene.fixture', { camera: 1 }]])
        const memento = (entries: Map<string, unknown>) => ({ keys: () => [...entries.keys()], get: (key: string) => entries.get(key), update: async (key: string, value: unknown) => { if (value === undefined) entries.delete(key); else entries.set(key, value) } })
        const storage = path.join(f.root, 'developer-storage')
        const cache = path.join(storage, 'cache')
        let memory = ['result']
        const registration = memoryCaches.register('Fixture memory cache', () => memory, () => { memory = [] })
        const controller = new DeveloperCacheController({ extensionMode: vscode.ExtensionMode.Development, globalStorageUri: vscode.Uri.file(storage), globalState: memento(global), workspaceState: memento(workspace) } as unknown as vscode.ExtensionContext, async (key) => { invalidated.push(key) }, undefined, async () => true)
        try {
            await fs.mkdir(cache, { recursive: true })
            await fs.writeFile(path.join(cache, 'runtime-fixture.json'), JSON.stringify({ builds: [123] }))
            const outside = path.join(f.root, 'outside.json')
            await fs.writeFile(outside, 'keep')
            await fs.symlink(outside, path.join(cache, 'linked.json'))
            const initial = await controller.getState()
            assert.ok(initial.entries.some((entry) => entry.id === 'globalState:fixture.cache'))
            assert.ok(initial.entries.some((entry) => entry.id === 'workspaceState:openscad.scene.fixture'))
            assert.ok(initial.entries.some((entry) => entry.name === 'Fixture memory cache'))
            assert.ok(initial.entries.some((entry) => entry.id === `disk:${path.join('cache', 'runtime-fixture.json')}`))
            assert.ok(!initial.entries.some((entry) => entry.name.endsWith('linked.json')))
            await assert.rejects(controller.handle({ action: 'development.clearCache', id: '../outside.json' }), /no longer exists/)
            await assert.rejects(controller.handle({ action: 'development.clearScopeCaches', scope: '../invalid' }), /Unknown cache scope/)
            await assert.rejects(controller.handle({ action: 'development.openCacheEditor', id: '../outside.json' }), /no longer exists/)
            await controller.handle({ action: 'development.openCacheEditor', id: 'globalState:fixture.cache' })
            const editor = vscode.window.activeTextEditor!
            assert.equal(editor.document.isUntitled, true)
            assert.equal(editor.document.languageId, 'json')
            assert.deepEqual(JSON.parse(editor.document.getText()), { list: [1, 2] })
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
            await controller.handle({ action: 'development.clearScopeCaches', scope: 'globalState' })
            assert.equal(global.size, 0)
            assert.equal(workspace.size, 1)
            assert.ok(invalidated.includes('fixture.cache'))
            await controller.handle({ action: 'development.clearAllCaches' })
            assert.equal(workspace.size, 0)
            assert.deepEqual(memory, [])
            assert.equal(await fs.readFile(outside, 'utf8'), 'keep')
            await assert.rejects(fs.access(path.join(cache, 'runtime-fixture.json')))
            const final = await controller.getState()
            assert.ok(!final.entries.some((entry) => ['globalState', 'workspaceState', 'Disk'].includes(entry.scope)))
        } finally {
            registration.dispose()
            await f.cleanup()
        }
    })

    test('Clearing a persisted Registry field drains pending writes and removes its legacy fallback and live copy', async () => {
        const f = await fixture()
        const key = registryCacheKey()
        const cached = { version: 1, sourceUrl: REGISTRY_URL, registry: registry() }
        const entries = new Map<string, unknown>([[key, cached]])
        const storage = { keys: () => [...entries.keys()], get: (key: string) => entries.get(key), update: async (key: string, value: unknown) => { if (value === undefined) entries.delete(key); else entries.set(key, value) } }
        let respond!: (response: Response) => void
        let started!: () => void
        const requested = new Promise<void>((resolve) => { started = resolve })
        const client = new RegistryClient(f.store.root, async () => { started(); return new Promise<Response>((resolve) => { respond = resolve }) }, undefined, storage)
        const panel = new LibraryPanelController(new ProjectDependencyManager(f.store, client, f.installer))
        const controller = new DeveloperCacheController({ extensionMode: vscode.ExtensionMode.Development, globalStorageUri: vscode.Uri.file(path.join(f.root, 'global')), globalState: storage, workspaceState: { keys: () => [] } } as unknown as vscode.ExtensionContext, async () => { await panel.clearRegistryCache() }, undefined, async () => true)
        try {
            const legacy = path.join(f.store.root, 'cache', 'registry.json')
            await fs.mkdir(path.dirname(legacy), { recursive: true })
            await fs.writeFile(legacy, JSON.stringify(cached))
            assert.equal((await panel.getState()).registry.length, 1)
            const loading = panel.loadRegistry()
            await requested
            const clearing = controller.handle({ action: 'development.clearCache', id: `globalState:${key}` })
            respond(new Response(JSON.stringify(registry())))
            await Promise.all([loading, clearing])
            assert.equal(entries.size, 0, 'A pending write cannot resurrect the cleared field')
            await assert.rejects(fs.access(legacy))
            assert.equal((await panel.getState()).registry.length, 0, 'Neither the live copy nor the legacy file can restore the cleared field')
        } finally {
            panel.dispose()
            await f.cleanup()
        }
    })

    test('Global bulk actions validate modes, report local verification and preserve project-used content', async () => {
        const f = await fixture()
        const controller = new LibraryPanelController(f.manager, async () => true)
        try {
            await f.manager.install(f.project, 'fixture', 'v1')
            f.offline()
            await controller.handle({ action: 'libraries.cleanupAll', mode: 'unsafe' })
            assert.match((await controller.getState()).error, /Invalid cache cleanup mode/)
            assert.equal((await f.store.list()).length, 1)
            await controller.handle({ action: 'libraries.verifyAll' })
            assert.match((await controller.getState()).bulkResult, /Verified 1 cached versions/)
            await controller.handle({ action: 'libraries.cleanupAll', mode: 'unused' })
            const all = await controller.getState()
            assert.equal(all.error, '')
            assert.match(all.bulkResult, /Deleted 0.*Skipped 1/)
            await controller.handle({ action: 'libraries.cleanupAll', mode: 'all' })
            assert.match((await controller.getState()).bulkResult, /Deleted 1 global dependency versions/)
            assert.equal((await f.store.list()).length, 0)
            assert.equal((await f.manager.list(f.project))[0].repositoryUrl, 'https://github.com/example/fixture')
            assert.match((await f.manager.list(f.project))[0].status, /Missing/)
            await fs.access(path.join(f.project, '.scad', 'dependencies.lock.json'))
        } finally {
            controller.dispose()
            await f.cleanup()
        }
    })

    test('Development folder action uses only the extension-owned global storage path', async () => {
        const f = await fixture()
        const revealed: string[] = []
        const storage = path.join(f.root, 'global-folder')
        const memento = { keys: () => [] }
        const controller = new DeveloperCacheController({ extensionMode: vscode.ExtensionMode.Development, globalStorageUri: vscode.Uri.file(storage), globalState: memento, workspaceState: memento } as unknown as vscode.ExtensionContext, async () => {}, async (uri) => { revealed.push(uri.fsPath) })
        try {
            await controller.handle({ action: 'development.openGlobalFolder', path: '/untrusted/request' })
            assert.deepEqual(revealed, [storage])
            assert.ok((await fs.stat(storage)).isDirectory())
            assert.equal((await controller.getState()).globalDirectory, storage)
        } finally { await f.cleanup() }
    })

    test('Cache highlighting uses the installed JSON TextMate grammar with editor theme colors', async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
        const value = { name: 'escaped "quote" <script>', count: -12.5e3, enabled: true, missing: null, nested: [1, 'two'] }
        const tokens = await highlightJson(value, extension.extensionUri)
        assert.equal(tokens.map((token) => token.text).join(''), JSON.stringify(value, null, 2))
        assert.ok(tokens.length > 10)
        assert.ok(tokens.some((token) => /^#[\da-f]{6}$/i.test(token.color ?? '')))
    })

})
