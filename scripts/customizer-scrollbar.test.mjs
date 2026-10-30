import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const { CustomizerService } = require('../out/core/customizer/CustomizerService.js')
let browser
before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => browser?.close())

async function fixture(t, extraSource = '') {
    const page = await browser.newPage({ viewport: { width: 360, height: 300 } })
    page.setDefaultTimeout(5000)
    const disposable = { dispose() {} }
    const noop = () => disposable
    const uri = (value) => {
        const scheme = value.startsWith('file:') ? 'file' : ''
        const path = scheme ? new URL(value).pathname : value
        return { path, fsPath: path, scheme, toString: () => value, with: (change) => uri(scheme ? `file://${change.path ?? path}` : (change.path ?? path)) }
    }
    const files = new Map()
    const dialogs = { names: [], open: [], save: [] }
    const watchers = []
    class FileSystemError extends Error {
        code = 'FileNotFound'
    }
    const configuration = new Map()
    const contexts = new Map()
    let configurationChanged
    const api = {
        commands: {
            executeCommand: async (command, key, value) => {
                if (command === 'setContext') contexts.set(key, value)
            },
        },
        window: {
            tabGroups: { activeTabGroup: {}, onDidChangeTabs: noop },
            onDidChangeActiveTextEditor: noop,
            showInputBox: async () => dialogs.names.shift(),
            showOpenDialog: async () => {
                const path = dialogs.open.shift()
                return path ? [uri(path)] : undefined
            },
            showSaveDialog: async () => {
                const path = dialogs.save.shift()
                return path ? uri(path) : undefined
            },
        },
        workspace: {
            textDocuments: [],
            fs: {
                readFile: async (value) => {
                    if (!files.has(value.toString())) throw new FileSystemError()
                    return Buffer.from(files.get(value.toString()))
                },
                writeFile: async (value, content) => {
                    files.set(value.toString(), Buffer.from(content).toString('utf8'))
                },
            },
            createFileSystemWatcher: () => {
                const callbacks = []
                const listen = (callback) => {
                    callbacks.push(callback)
                    return disposable
                }
                const watcher = {
                    dispose: () => {
                        callbacks.length = 0
                    },
                    onDidCreate: listen,
                    onDidChange: listen,
                    onDidDelete: listen,
                    callbacks,
                }
                watchers.push(watcher)
                return watcher
            },
            onDidChangeTextDocument: noop,
            onDidOpenTextDocument: noop,
            onDidCloseTextDocument: noop,
            onDidChangeConfiguration: (callback) => {
                configurationChanged = callback
                return disposable
            },
            getConfiguration: () => ({ get: (key, fallback) => configuration.get(key) ?? fallback }),
            asRelativePath: (value) => value.path,
        },
        EventEmitter: class {
            listeners = new Set()
            event = (listener) => {
                this.listeners.add(listener)
                return { dispose: () => this.listeners.delete(listener) }
            }
            fire(value) {
                this.listeners.forEach((listener) => listener(value))
            }
            dispose() {
                this.listeners.clear()
            }
        },
        Uri: { file: (path) => uri(`file://${path}`), joinPath: (base, ...parts) => uri((base.scheme === 'file' ? 'file://' : '') + join(base.path, ...parts)), parse: uri },
        FileSystemError,
        RelativePattern: class {},
        TabInputCustom: class {},
    }
    const controllerModule = { exports: {} }
    runInNewContext(transformSync(readFileSync(join(root, 'src/features/sidebar/CustomizerPresets.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
        module: controllerModule,
        Buffer,
        require: (name) => (name === 'vscode' ? api : name === '../../core/customizer/CustomizerPresets' ? require('../out/core/customizer/CustomizerPresets.js') : require(name)),
    })
    const module = { exports: {} }
    runInNewContext(transformSync(readFileSync(join(root, 'src/features/sidebar/CustomizerViewProvider.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
        module,
        Buffer,
        require: (name) => (name === 'vscode' ? api : name === './CustomizerPresets' ? controllerModule.exports : require(name)),
    })
    const service = new CustomizerService()
    const provider = new module.exports.CustomizerViewProvider(service, uri('/'))
    let receive
    const messages = []
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    let closing = false
    const pendingMessages = new Set()
    const webview = {
        options: {},
        html: '',
        cspSource: "'self'",
        asWebviewUri: (value) => value.toString(),
        onDidReceiveMessage: (callback) => {
            receive = callback
            return disposable
        },
        postMessage: (data) => {
            if (page.isClosed() || closing) return Promise.resolve(false)
            const pending = page
                .evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data)
                .then(() => true)
                .catch((error) => {
                    if (closing) return false
                    throw error
                })
                .finally(() => pendingMessages.delete(pending))
            pendingMessages.add(pending)
            return pending
        },
    }
    const view = { webview, onDidDispose: noop, onDidChangeVisibility: noop }
    provider.resolveWebviewView(view)
    const source = '/* [Geometry] */\n' + Array.from({ length: 80 }, (_, i) => `field_${i} = ${i};`).join('\n') + '\n/* [Options] */\nlabel="Model";\nquality=2; // [1:Draft, 2:Normal]\nhollow=true;\n' + extraSource
    service.load('file:///models/customizer.scad', source)
    const previewSessions = []
    const renderModule = { exports: {} }
    runInNewContext(transformSync(readFileSync(join(root, 'src/features/preview/extension/services/ScadRenderer.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
        module: renderModule,
        Buffer,
        AbortController,
        require: (name) => {
            if (name === 'vscode') return api
            if (name.endsWith('/ScadClient')) return { ScadClient: { render: async (_path, values) => Buffer.from(JSON.stringify(values)) } }
            if (name.endsWith('/csg/compile')) return { compileCsg: async (buffer) => buffer }
            if (name.endsWith('/ModelFormat')) return require('../out/features/preview/shared/types/ModelFormat.js')
            if (name.endsWith('/previewEligibility')) return { EmptyModelError: class extends Error {} }
            throw new Error(`Unexpected renderer dependency: ${name}`)
        },
    })
    const sessionModule = { exports: {} }
    runInNewContext(transformSync(readFileSync(join(root, 'src/features/preview/extension/core/ScadSession.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
        module: sessionModule,
        Buffer,
        setTimeout,
        clearTimeout,
        require: (name) => {
            if (name === 'vscode') return api
            if (name.endsWith('/ScadClient')) return { ScadClient: { cancelRender() {} } }
            if (name.endsWith('/ScadParser')) return require('../out/features/preview/extension/services/ScadParser.js')
            if (name.endsWith('/ScadParameters')) return require('../out/features/preview/extension/core/ScadParameters.js')
            if (name.endsWith('/ScadRenderer')) return renderModule.exports
            if (name.endsWith('/ScadWatcher'))
                return {
                    FileWatcher: class {
                        close() {}
                    },
                }
            throw new Error(`Unexpected session dependency: ${name}`)
        },
    })
    await page.exposeBinding('sendToHost', (_, data) => {
        messages.push(data)
        return receive(data)
    })
    await page.addInitScript(() => {
        window.acquireVsCodeApi = () => ({
            getState: () => JSON.parse(sessionStorage.getItem('customizer-state') ?? 'null'),
            setState: (value) => sessionStorage.setItem('customizer-state', JSON.stringify(value)),
            postMessage: (data) => {
                void window.sendToHost(data)
            },
        })
    })
    const server = createServer((request, response) => {
        const pathname = new URL(request.url, 'http://fixture').pathname
        if (pathname === '/') {
            response.setHeader('Content-Type', 'text/html')
            // Model the host's injected stylesheet as an external sheet under the same CSP.
            response.end(webview.html.replace('</head>', '<link rel="stylesheet" href="/theme.css"></head>'))
        } else if (pathname === '/theme.css') {
            response.setHeader('Content-Type', 'text/css')
            response.end(':root{--vscode-font-family:sans-serif;--vscode-font-size:13px;--vscode-font-weight:400;--vscode-sideBar-background:#252526;--vscode-sideBar-foreground:#ccc;--vscode-foreground:#ccc;--vscode-scrollbarSlider-background:rgba(121,121,121,.4);--vscode-scrollbarSlider-hoverBackground:rgba(100,100,100,.7);--vscode-scrollbarSlider-activeBackground:rgba(191,191,191,.4);--vscode-scrollbar-shadow:rgba(0,0,0,.4);--vscode-input-background:#3c3c3c;--vscode-input-foreground:#ccc;--vscode-progressBar-background:#007acc;--vscode-editorHoverWidget-background:#252526;--vscode-editorHoverWidget-foreground:#ccc;--vscode-editorHoverWidget-border:#555;}')
        } else if (/^\/(?:dist\/customizer\.(?:js|css)|dist\/codicons\/codicon\.(?:css|ttf)|media\/customizer\/main\.css)$/.test(pathname)) {
            response.setHeader('Content-Type', pathname.endsWith('.ttf') ? 'font/ttf' : pathname.endsWith('.js') ? 'text/javascript' : 'text/css')
            response.end(readFileSync(join(root, pathname)))
        } else {
            response.statusCode = 404
            response.end()
        }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => {
        closing = true
        provider.dispose()
        await Promise.all(pendingMessages)
        await provider.presetOperations
        previewSessions.forEach((session) => session.dispose())
        await page.close()
        await new Promise((resolve) => server.close(resolve))
        assert.deepEqual(errors, [], 'The bundled native component must run under the webview CSP')
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('[data-name="field_0"]').waitFor()
    await page.locator('.has-vertical-scrollbar').waitFor()
    return {
        page,
        view,
        contexts,
        nativeAction: (action) => provider.runAction(action),
        service,
        messages,
        files,
        dialogs,
        attachPreview() {
            const session = new sessionModule.exports.ScadSession({ uri: uri('file:///models/customizer.scad'), getText: () => source }, service)
            previewSessions.push(session)
            const frames = []
            session.onRenderCompleted((result) => frames.push(JSON.parse(result.buffer.toString())))
            return {
                frames,
                nextFrame: () =>
                    new Promise((resolve) => {
                        const subscription = session.onRenderCompleted((result) => {
                            subscription.dispose()
                            resolve(JSON.parse(result.buffer.toString()))
                        })
                    }),
            }
        },
        refreshPresets() {
            watchers.forEach((watcher) => watcher.callbacks[0]?.())
        },
        configure(key, value) {
            configuration.set(key, value)
            configurationChanged({ affectsConfiguration: (section) => section === 'workbench.list' || section === 'workbench.experimental.modernUI' })
        },
    }
}

async function openPresetFile(page, dialogs, path) {
    dialogs.open.push(path)
    await page.getByRole('button', { name: 'Import presets', exact: true }).click()
    await page.waitForFunction((name) => document.querySelector('#preset-file').textContent === name, path.split('/').at(-1))
}

async function clickPresetMenu(page, name) {
    await page.getByRole('button', { name: 'More preset actions', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
}

test('native scrollbar scrolls with the wheel, drags, fades and uses VS Code theme variables', async (t) => {
    const { page } = await fixture(t)
    const viewport = page.locator('main')
    const thumb = page.locator('.scrollbar.vertical .slider')
    await page.mouse.move(120, 120)
    await page.mouse.wheel(0, 150)
    await page.waitForFunction(() => document.querySelector('main').scrollTop > 0)
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'The document itself must not scroll')
    const before = await viewport.evaluate((el) => el.scrollTop)
    const box = await thumb.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.locator('.scrollbar.vertical .slider.active').waitFor()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 8 })
    await page.mouse.up()
    assert.ok((await viewport.evaluate((el) => el.scrollTop)) > before)
    await page.mouse.move(-20, -20)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.scrollbar.vertical')).opacity === '0')
    await page.mouse.move(120, 120)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.scrollbar.vertical')).opacity === '1')
    await page.evaluate(() => document.documentElement.style.setProperty('--vscode-scrollbarSlider-background', 'rgb(23, 45, 67)'))
    assert.equal(await thumb.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(23, 45, 67)')
    assert.notEqual(await page.locator('.shadow.top:not(.top-left-corner)').evaluate((el) => getComputedStyle(el).boxShadow), 'none')
})

test('collapse, viewport resize, keyboard focus and file changes update native scroll dimensions', async (t) => {
    const { page, service, messages } = await fixture(t)
    await page.locator('[data-group-kind="parameters"] > .group-row').first().click()
    await page.waitForFunction(() => !document.querySelector('.has-vertical-scrollbar'))
    await page.keyboard.press('ArrowRight')
    await page.locator('.has-vertical-scrollbar').waitFor()
    await page.keyboard.press('End')
    await page.waitForFunction(() => document.querySelector('main').scrollTop > 0)
    await page.getByRole('textbox', { name: 'label', exact: true }).fill('New model')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => document.querySelector('[data-name="label"]').classList.contains('modified'))
    assert.equal(service.getOverrides('file:///models/customizer.scad').label, 'New model')
    for (const width of [230, 360]) {
        await page.setViewportSize({ width, height: 240 })
        await page.waitForFunction(() => document.querySelector('.scrollbar.vertical').clientHeight === document.querySelector('main').clientHeight)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        assert.equal(
            await page
                .locator('.control')
                .last()
                .evaluate((el) => el.getBoundingClientRect().right > document.querySelector('.scrollbar.vertical').getBoundingClientRect().left),
            false,
            'Overlay scrollbar must not cover inputs',
        )
    }
    service.load('file:///models/empty.scad', 'cube(2);')
    // Request a fresh snapshot through the actual provider message boundary.
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    await page.waitForFunction(() => document.querySelector('main').scrollTop === 0 && !document.querySelector('.has-vertical-scrollbar'))
    assert.ok(messages.some((message) => message.type === 'set'))
})

test('host list settings update scrollbar width and wheel behavior without replacing controls', async (t) => {
    const { page, configure } = await fixture(t)
    await page.locator('[data-name="field_0"] input').focus()
    configure('experimental.modernUI', true)
    await page.waitForFunction(() => document.querySelector('.scrollbar.vertical').clientWidth === 8)
    assert.equal(await page.locator('.scrollbar.vertical .slider').evaluate((el) => getComputedStyle(el).borderRadius), '4px')
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'field_0')
    configure('list.mouseWheelScrollSensitivity', 2)
    configure('list.fastScrollSensitivity', 7)
    configure('list.smoothScrolling', true)
    await page.mouse.move(120, 120)
    await page.mouse.wheel(0, 150)
    await page.waitForFunction(() => document.querySelector('main').scrollTop > 0)
    configure('experimental.modernUI', false)
    await page.waitForFunction(() => document.querySelector('.scrollbar.vertical').clientWidth === 10)
    assert.equal(await page.locator('.scrollbar.vertical .slider').evaluate((el) => getComputedStyle(el).borderRadius), '0px')
})

test('native view title identifies the model and switches between collapse and expand actions', async (t) => {
    const { page, service, view, contexts, nativeAction } = await fixture(t)
    assert.equal(view.description, 'customizer')
    assert.equal(await page.locator('#toolbar, #filename, #reset-all, #collapse-all').count(), 0)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const actions = manifest.contributes.menus['view/title'].filter((item) => item.command.startsWith('scad-ai-ide.customizer.'))
    assert.equal(actions.length, 3)
    const collapsed = () => contexts.get('scad-ai-ide.customizer.allCollapsed')
    service.set('field_0', 5)
    await nativeAction('collapseAll')
    await page.waitForFunction(() => [...document.querySelectorAll('#tree > [role="treeitem"]')].every((group) => group.getAttribute('aria-expanded') === 'false'))
    assert.equal(collapsed(), true)
    assert.equal(service.getOverrides('file:///models/customizer.scad').field_0, 5)
    await page.reload()
    await page.locator('[data-group-kind="parameters"] > .group-row').first().waitFor()
    assert.deepEqual(await page.locator('#tree > [role="treeitem"]').evaluateAll((groups) => groups.map((group) => group.getAttribute('aria-expanded'))), ['false', 'false', 'false'])
    await nativeAction('expandAll')
    assert.equal(collapsed(), false)
    await page.locator('[data-group-kind="parameters"] > .group-row').first().click()
    assert.equal(collapsed(), false)
    await page.locator('[data-group-kind="parameters"] > .group-row').nth(1).click()
    assert.equal(collapsed(), false, 'An expanded preset section keeps Collapse All')
    await page.locator('[data-group-kind="presets"] > .group-row').click()
    assert.equal(collapsed(), true)
    await nativeAction('resetAll')
    await page.waitForFunction(() => !document.querySelector('.modified'))
    assert.deepEqual(service.getOverrides('file:///models/customizer.scad'), {})
    await page.locator('[data-group-kind="parameters"] > .group-row').first().focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(collapsed(), false)
    service.load('file:///models/my.part.SCAd', '/* [Global] */\nwidth=1;')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    assert.equal(view.description, 'my.part')
    await nativeAction('collapseAll')
    assert.equal(await page.locator('[data-name="width"]').isVisible(), true)
})

test('decimal sliders, mixed menus, default menu entries and vector labels stay editable', async (t) => {
    const { page, service } = await fixture(t, 'fraction=0.5; // [0:1]\nmode="auto"; // [auto:Automatic,1:One,2:Two]\nextra=3; // [1,2]\nsize=[1,2,3];')
    const slider = page.getByRole('slider', { name: 'fraction', exact: true })
    assert.equal(await slider.inputValue(), '0.5')
    assert.equal(await slider.getAttribute('step'), '0.1')
    assert.equal(await page.locator('[data-name="fraction"] input[type="number"]').count(), 0)
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('[data-name="fraction"]').classList.contains('modified'))
    assert.equal(service.getOverrides('file:///models/customizer.scad').fraction, 0.6)
    await page.getByRole('combobox', { name: 'mode', exact: true }).selectOption('2')
    await page.waitForFunction(() => document.querySelector('[data-name="mode"]').classList.contains('modified'))
    assert.equal(service.getOverrides('file:///models/customizer.scad').mode, 2)
    const extra = page.getByRole('combobox', { name: 'extra', exact: true })
    await extra.selectOption('1')
    await page.waitForFunction(() => document.querySelector('[data-name="extra"]').classList.contains('modified'))
    await extra.selectOption('0')
    await page.waitForFunction(() => !document.querySelector('[data-name="extra"]').classList.contains('modified'))
    assert.equal(await extra.inputValue(), '0')
    assert.equal(await page.locator('.error:not([hidden])').count(), 0)
    assert.deepEqual(await page.locator('[data-name="size"] .vector-axis').allTextContents(), ['X', 'Y', 'Z'])
})

test('preset create, save, default, import, partial selection, export and delete use OpenSCAD JSON', async (t) => {
    const { page, service, files, dialogs } = await fixture(t)
    dialogs.names.push('Wide')
    dialogs.save.push('file:///models/my-presets.json')
    await clickPresetMenu(page, 'New preset')
    await page.waitForFunction(() => document.querySelector('#preset-select').selectedOptions[0].textContent === 'Wide')
    const sidecar = 'file:///models/my-presets.json'
    assert.equal(JSON.parse(files.get(sidecar)).parameterSets.Wide.label, 'Model')
    service.set('field_0', 15)
    await page.waitForFunction(() => document.querySelector('#preset-select').selectedOptions[0].textContent === 'Wide · Unsaved')
    await page.getByRole('button', { name: 'Save preset', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#preset-select').selectedOptions[0].textContent === 'Wide')
    assert.equal(JSON.parse(files.get(sidecar)).parameterSets.Wide.field_0, '15')
    await page.getByRole('combobox', { name: 'Parameter preset', exact: true }).selectOption('')
    await page.waitForFunction(() => !document.querySelector('.modified'))
    assert.deepEqual(service.getOverrides('file:///models/customizer.scad'), {})
    service.set('field_1', 19)
    const imported = 'file:///models/imported.json'
    files.set(imported, JSON.stringify({ fileFormatVersion: '1', metadata: 'preserve me', parameterSets: { Partial: { field_0: '7', unknown: 'keep me' }, Other: { label: 'Other model' } } }))
    dialogs.open.push(imported)
    await page.getByRole('button', { name: 'Import presets', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#preset-file').textContent === 'imported.json')
    assert.equal(service.getOverrides('file:///models/customizer.scad').field_1, 19, 'Import does not apply a set')
    await page.getByRole('combobox', { name: 'Parameter preset', exact: true }).selectOption('0')
    await page.waitForFunction(() => document.querySelector('[data-name="field_0"] input').value === '7')
    assert.deepEqual(service.getOverrides('file:///models/customizer.scad'), { field_0: 7, field_1: 19 })
    await page.getByRole('button', { name: 'Save preset', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#preset-select').selectedOptions[0].textContent === 'Partial')
    dialogs.save.push('file:///models/exported.json')
    await clickPresetMenu(page, 'Export presets')
    await page.waitForFunction(() => window.sendToHost !== undefined)
    // Wait for the asynchronous file-dialog/write chain through a state update.
    await page.waitForFunction(() => document.querySelector('#preset-file').textContent === 'imported.json')
    for (let attempt = 0; attempt < 30 && !files.has('file:///models/exported.json'); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    const exported = JSON.parse(files.get('file:///models/exported.json'))
    assert.equal(exported.metadata, 'preserve me')
    assert.equal(exported.parameterSets.Partial.unknown, 'keep me')
    assert.deepEqual(exported.parameterSets.Other, { label: 'Other model' })
    await clickPresetMenu(page, 'Delete preset')
    await page.waitForFunction(() => ![...document.querySelector('#preset-select').options].some((option) => option.textContent.startsWith('Partial')))
    assert.equal(JSON.parse(files.get(imported)).parameterSets.Partial, undefined)
    assert.equal(service.getOverrides('file:///models/customizer.scad').field_0, 7, 'Deleting a preset preserves current edits')
})

test('removed panel settings stay absent and invalid imports preserve the working model', async (t) => {
    const { page, service, files, dialogs } = await fixture(t, '// Model fraction\nfraction=0.5; // [0:1]')
    assert.equal(await page.locator('#automatic-preview, #details-mode, #preview-now').count(), 0)
    await page.reload()
    await page.locator('[data-name="fraction"]').waitFor()
    assert.equal(await page.locator('#automatic-preview, #details-mode').count(), 0)
    files.set('file:///models/invalid.json', '{"parameterSets":{"Bad":{"fraction":2}}}')
    dialogs.open.push('file:///models/invalid.json')
    await page.getByRole('button', { name: 'Import presets', exact: true }).click()
    await page.locator('#panel-error:not([hidden])').waitFor()
    assert.match(await page.locator('#panel-error').textContent(), /Invalid parameter set/)
    assert.deepEqual(service.getOverrides('file:///models/customizer.scad'), {})
    assert.equal(await page.locator('#preset-file').textContent(), '')
})

test('a preset dialog cannot write into a different active file', async (t) => {
    const { page, service, files, dialogs } = await fixture(t)
    let finish
    dialogs.names.push(
        new Promise((resolve) => {
            finish = resolve
        }),
    )
    await clickPresetMenu(page, 'New preset')
    service.load('file:///models/second.scad', '/* [Global] */\nwidth=2;')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    await page.locator('[data-name="width"]').waitFor()
    finish('Wrong target')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    assert.equal(files.size, 0)
    assert.equal(await page.locator('#preset-file').textContent(), '')
})

test('sidecar reload, invalid preset selection and compact panel layout preserve model state', async (t) => {
    const { page, dialogs, service, files, refreshPresets } = await fixture(t)
    const target = 'file:///models/customizer.scad'
    service.load(target, '/* [Geometry] */\n// Model width\nwidth=0.5; // [0:1]\nsize=[1,2,3,4];\n/* [Options] */\nmode="auto"; // [auto,1,2]\nlabel="Model";\nhollow=true;')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    await page.getByRole('slider', { name: 'width', exact: true }).waitFor()
    const sidecar = 'file:///models/customizer.json'
    files.set(sidecar, JSON.stringify({ fileFormatVersion: '1', parameterSets: { Good: { width: '0.7' }, Bad: { hollow: 'false', width: '2' } } }))
    await openPresetFile(page, dialogs, 'file:///models/customizer.json')
    await page.waitForFunction(() => [...document.querySelector('#preset-select').options].some((option) => option.textContent === 'Good'))
    const preset = page.getByRole('combobox', { name: 'Parameter preset', exact: true })
    await preset.selectOption('0')
    await page.waitForFunction(() => document.querySelector('[data-name="width"] input').value === '0.7')
    await preset.selectOption('1')
    await page.locator('#panel-error:not([hidden])').waitFor()
    assert.equal(await preset.inputValue(), '0', 'A failed selection must restore the actual active preset')
    assert.deepEqual(service.getOverrides(target), { width: 0.7 }, 'Invalid sets must not partially change another parameter')
    files.set(sidecar, JSON.stringify({ fileFormatVersion: '1', parameterSets: { Good: { width: '0.7' } } }))
    refreshPresets()
    await page.waitForFunction(() => document.querySelector('#panel-error').hidden)
    for (const width of [230, 360]) {
        await page.setViewportSize({ width, height: 600 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        const bounds = await page.locator('#preset-more').boundingBox()
        assert.ok(bounds.x + bounds.width <= width, 'Preset actions must fit inside the sidebar')
    }
    if (process.env.SCAD_CUSTOMIZER_SCREENSHOT) await page.screenshot({ path: process.env.SCAD_CUSTOMIZER_SCREENSHOT })
})

test('range sliders send intermediate values before pointer release and retain the final value', async (t) => {
    const { page, service, messages } = await fixture(t, 'width=20; // [0:1:100]')
    service.setContinuousPreview('file:///models/customizer.scad', true)
    const slider = page.getByRole('slider', { name: 'width', exact: true })
    await page.waitForFunction(() => document.querySelector('[data-name="width"]'))
    await slider.scrollIntoViewIfNeeded()
    const box = await slider.boundingBox()
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
    await page.mouse.down()
    try {
        await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 5 })
        await page.waitForFunction(() => document.querySelector('[data-name="width"]').classList.contains('modified'))
        const middle = service.getOverrides('file:///models/customizer.scad').width
        assert.ok(middle > 20 && middle < 70, 'The host must receive a value while the mouse button is held')
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 })
        await page.waitForFunction(() => Number(document.querySelector('[data-name="width"] input').value) > 70)
        for (let i = 0; i < 50 && (service.getOverrides('file:///models/customizer.scad').width ?? 0) <= 70; i++) await new Promise((resolve) => setTimeout(resolve, 10))
        assert.ok(service.getOverrides('file:///models/customizer.scad').width > 70)
        assert.ok(messages.filter((message) => message.type === 'set' && message.name === 'width').length > 2)
    } finally {
        await page.mouse.up()
    }
    const final = Number(await slider.inputValue())
    for (let i = 0; i < 50 && service.getOverrides('file:///models/customizer.scad').width !== final; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(service.getOverrides('file:///models/customizer.scad').width, final)
})

test('preset dropdown reaches the real Preview session and renderer, including cold startup and design defaults', async (t) => {
    const { page, dialogs, files, refreshPresets, attachPreview } = await fixture(t)
    const { frames, nextFrame } = attachPreview()
    files.set('file:///models/customizer.json', JSON.stringify({ fileFormatVersion: '1', parameterSets: { Small: { field_0: '7' }, Large: { field_0: '23' } } }))
    await openPresetFile(page, dialogs, 'file:///models/customizer.json')
    const select = page.getByRole('combobox', { name: 'Parameter preset', exact: true })
    await page.waitForFunction(() => document.querySelector('#preset-select').options.length === 3)
    let completed = nextFrame()
    await select.selectOption('0')
    assert.equal((await completed).field_0, 7)
    completed = nextFrame()
    await select.selectOption('1')
    assert.equal((await completed).field_0, 23)
    completed = nextFrame()
    await select.selectOption('0')
    assert.equal((await completed).field_0, 7)
    completed = nextFrame()
    await select.selectOption('')
    assert.deepEqual(await completed, {})
    assert.equal(frames.length, 4, 'One explicit preset selection produces one completed frame')
})

test('active presets follow file edits and mark edits outside partial presets as unsaved', async (t) => {
    const { page, dialogs, service, files, refreshPresets, attachPreview } = await fixture(t)
    const { nextFrame } = attachPreview()
    const sidecar = 'file:///models/customizer.json'
    const write = (value) => files.set(sidecar, JSON.stringify({ fileFormatVersion: '1', parameterSets: { Partial: { field_0: String(value) } } }))
    write(7)
    await openPresetFile(page, dialogs, 'file:///models/customizer.json')
    const select = page.getByRole('combobox', { name: 'Parameter preset', exact: true })
    await page.waitForFunction(() => document.querySelector('#preset-select').options.length === 2)
    let completed = nextFrame()
    await select.selectOption('0')
    await completed
    completed = nextFrame()
    write(9)
    refreshPresets()
    assert.equal((await completed).field_0, 9, 'Changing the active preset file updates Preview')
    completed = nextFrame()
    service.set('field_1', 55)
    await completed
    await page.waitForFunction(() => document.querySelector('#preset-select').selectedOptions[0].textContent === 'Partial · Unsaved')
    write(11)
    refreshPresets()
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    assert.deepEqual(service.getOverrides('file:///models/customizer.scad'), { field_0: 9, field_1: 55 }, 'External edits preserve unsaved model changes')
})

test('preset file sits left of actions with the menu below, and every action has a hover label', async (t) => {
    const { page, files, dialogs } = await fixture(t)
    files.set('file:///models/variants.json', JSON.stringify({ fileFormatVersion: '1', parameterSets: {} }))
    await openPresetFile(page, dialogs, 'file:///models/variants.json')
    for (const width of [230, 360]) {
        await page.setViewportSize({ width, height: 600 })
        const filename = await page.locator('#preset-file').boundingBox()
        const actions = await page.locator('.preset-actions').boundingBox()
        const select = await page.locator('#preset-select').boundingBox()
        assert.ok(filename.x + filename.width <= actions.x)
        assert.ok(select.y >= actions.y + actions.height)
        assert.ok(select.width > actions.width)
    }
    for (const [action, text] of [
        ['save', 'select a named preset first'],
        ['import', 'open any OpenSCAD'],
        ['more', 'More preset actions'],
    ]) {
        await page.locator(`.toolbar-action:has(#preset-${action})`).hover()
        await page.locator('#tooltip:not([hidden])').waitFor()
        assert.ok((await page.locator('#tooltip').textContent()).includes(text), `${action} needs a complete hover label, including when disabled`)
        await page.mouse.move(0, 590)
    }
    await page.locator('#preset-file').hover()
    await page.locator('#tooltip:not([hidden])').waitFor()
    assert.match(await page.locator('#tooltip').textContent(), /Preset file:.*variants.json/)
})

test('ordinary and fallback sliders submit only after release, including fallback during a drag', async (t) => {
    const { page, service, messages } = await fixture(t, 'width=20; // [0:1:100]')
    const slider = page.getByRole('slider', { name: 'width', exact: true })
    await slider.scrollIntoViewIfNeeded()
    const box = await slider.boundingBox()
    const dragTo = async (fraction) => {
        await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 5 })
        await page.waitForTimeout(50)
    }
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
    await page.mouse.down()
    await dragTo(0.6)
    assert.equal(messages.filter((m) => m.type === 'set' && m.name === 'width').length, 0)
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('[data-name="width"]').classList.contains('modified'))
    assert.equal(messages.filter((m) => m.type === 'set' && m.name === 'width').length, 1)
    service.setContinuousPreview('file:///models/customizer.scad', true)
    await page.waitForTimeout(100)
    await page.mouse.down()
    await dragTo(0.4)
    const intermediate = service.getOverrides('file:///models/customizer.scad').width
    assert.ok(intermediate < 50)
    service.setContinuousPreview('file:///models/customizer.scad', false)
    await page.waitForTimeout(100)
    const count = messages.filter((m) => m.type === 'set' && m.name === 'width').length
    await dragTo(0.85)
    assert.equal(messages.filter((m) => m.type === 'set' && m.name === 'width').length, count)
    assert.equal(service.getOverrides('file:///models/customizer.scad').width, intermediate)
    await page.mouse.up()
    for (let i = 0; i < 50 && (service.getOverrides('file:///models/customizer.scad').width ?? 0) < 80; i++) await new Promise((r) => setTimeout(r, 10))
    assert.ok(service.getOverrides('file:///models/customizer.scad').width >= 80)
    assert.equal(messages.filter((m) => m.type === 'set' && m.name === 'width').length, count + 1)
})

test('preset section shares parameter folding, font size and persisted state', async (t) => {
    const { page, service, nativeAction } = await fixture(t)
    const presets = page.locator('[data-group-kind="presets"]')
    const heading = presets.locator('.group-row')
    assert.equal(await presets.getAttribute('aria-label'), 'Presets')
    assert.equal(await presets.getAttribute('aria-expanded'), 'true')
    const fontSizes = await page.evaluate(() => ['#preset-file', '.parameter-label', '.group-label'].map((selector) => getComputedStyle(document.querySelector(selector)).fontSize))
    assert.equal(new Set(fontSizes).size, 1)
    await heading.click()
    assert.equal(await page.locator('#preset-select').isVisible(), false)
    assert.equal(await page.locator('[data-name="field_0"]').isVisible(), true)
    service.set('field_0', 4)
    assert.equal(await presets.getAttribute('aria-expanded'), 'false', 'Parameter updates must preserve folding')
    await page.reload()
    await heading.waitFor()
    assert.equal(await presets.getAttribute('aria-expanded'), 'false')
    await heading.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.locator('#preset-select').isVisible(), true)
    assert.equal(service.getOverrides('file:///models/customizer.scad').field_0, 4)
    await nativeAction('collapseAll')
    assert.equal(await presets.getAttribute('aria-expanded'), 'false')
    await nativeAction('expandAll')
    assert.equal(await presets.getAttribute('aria-expanded'), 'true')
})

test('parameter controls grow with the sidebar and wrap vectors without losing edits or overflowing', async (t) => {
    const { page, service } = await fixture(t)
    service.load('file:///models/customizer.scad', '/* [Adaptive] */\nlong_parameter_name_for_a_model_label="Current model";\ncount=123456.75;\nsize=[10,20,30,40];\nfraction=0.5; // [0:1]\nmode="auto"; // [auto:Automatic quality selection,manual:Manual quality selection]\nvisible=true;')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    const label = page.getByRole('textbox', { name: 'long_parameter_name_for_a_model_label', exact: true })
    await label.fill('Keep this edit while resizing')
    const widths = new Map()
    for (const width of [160, 200, 230, 360, 640]) {
        await page.setViewportSize({ width, height: 600 })
        const layout = await page.evaluate(() => {
            const rightEdge = document.querySelector('main').getBoundingClientRect().right - (document.querySelector('.has-vertical-scrollbar') ? document.querySelector('.scrollbar.vertical').clientWidth : 0)
            const inputs = [...document.querySelectorAll('#tree .control input, #tree .control select')]
            return {
                overflow: document.documentElement.scrollWidth > innerWidth,
                withinSidebar: inputs.every((input) => input.getBoundingClientRect().right <= rightEdge + 1 && input.getBoundingClientRect().left >= 0),
                sidebarWidth: document.querySelector('#tree').getBoundingClientRect().width,
                ordinaryWidths: [...document.querySelectorAll('.control:not(.vector)')].map((control) => control.getBoundingClientRect().width),
                controlRightEdges: [...document.querySelectorAll('.control')].map((control) => control.getBoundingClientRect().right),
                vectorWidth: document.querySelector('.control.vector').getBoundingClientRect().width,
                textWidth: document.querySelector('[data-name="long_parameter_name_for_a_model_label"] .control').getBoundingClientRect().width,
                numberWidth: document.querySelector('[data-name="count"] input').getBoundingClientRect().width,
                vectorWidths: [...document.querySelectorAll('.vector-component input')].map((input) => input.getBoundingClientRect().width),
                numberSameRow: Math.abs(document.querySelector('[data-name="count"] .parameter-label').getBoundingClientRect().top - document.querySelector('[data-name="count"] .control').getBoundingClientRect().top) < 5,
                labelWidth: document.querySelector('[data-name="count"] .parameter-label').getBoundingClientRect().width,
                vectorRows: new Set([...document.querySelectorAll('.vector-component')].map((component) => component.getBoundingClientRect().top)).size,
            }
        })
        assert.equal(layout.overflow, false)
        assert.equal(layout.withinSidebar, true)
        assert.ok(Math.max(...layout.controlRightEdges) - Math.min(...layout.controlRightEdges) < 1, 'Every parameter control, including checkboxes, must share the same right edge')
        assert.ok(
            layout.ordinaryWidths.every((control) => control <= layout.sidebarWidth * 0.5 + 1),
            'Ordinary controls must be capped at half the sidebar width',
        )
        assert.ok(layout.vectorWidth <= layout.sidebarWidth * 0.65 + 1, 'Vectors must be capped at 65% of the sidebar width')
        assert.ok(
            layout.vectorWidths.every((component) => component >= 20),
            'Vector values must remain readable',
        )
        widths.set(width, layout)
        assert.equal(await label.inputValue(), 'Keep this edit while resizing')
        assert.equal(await label.evaluate((input) => input === document.activeElement), true, 'Resizing must preserve input focus')
        if (process.env.SCAD_CUSTOMIZER_SCREENSHOT && [230, 640].includes(width)) await page.screenshot({ path: process.env.SCAD_CUSTOMIZER_SCREENSHOT.replace(/\.png$/, `-${width}.png`) })
    }
    assert.ok(widths.get(640).textWidth > widths.get(360).textWidth)
    assert.ok(widths.get(640).numberWidth > widths.get(360).numberWidth)
    assert.ok(widths.get(640).textWidth > 132, 'Wide panels must not retain the old control cap')
    assert.ok(widths.get(360).numberWidth > 60, 'Numeric inputs must not retain the old fixed width')
    assert.equal(widths.get(200).numberSameRow, true, 'Compact controls should remain beside their label at 200px')
    assert.ok(widths.get(640).labelWidth < 60, 'Short labels must not reserve a wide empty column')
    assert.equal(widths.get(230).vectorRows, 1, 'Short vector values should fit compactly in one row')
    await label.press('Tab')
    await page.waitForFunction(() => document.querySelector('[data-name="long_parameter_name_for_a_model_label"]').classList.contains('modified'))
    assert.equal(service.getOverrides('file:///models/customizer.scad').long_parameter_name_for_a_model_label, 'Keep this edit while resizing')
})

test('Customizer icon groups use VS Code spacing tokens with consistent fallbacks', async (t) => {
    const { page, service } = await fixture(t)
    service.set('field_0', 4)
    await page.waitForFunction(() => document.querySelector('[data-name="field_0"]').classList.contains('modified'))
    const gaps = () => page.evaluate(() => ['.preset-actions', '.parameter-row.modified'].map((selector) => getComputedStyle(document.querySelector(selector)).columnGap))
    assert.deepEqual(await gaps(), ['4px', '4px'])
    assert.equal(await page.locator('#preset-more').evaluate((button) => button.getBoundingClientRect().width), 22, 'Toolbar buttons must retain the standard 22px hit area')
    await page.evaluate(() => document.documentElement.style.setProperty('--vscode-spacing-size40', '6px'))
    assert.deepEqual(await gaps(), ['6px', '6px'])
    await page.setViewportSize({ width: 160, height: 600 })
    const actions = await page.locator('#preset-more').boundingBox()
    assert.ok(actions.x + actions.width <= 160, 'Standard icon spacing must not clip the last action in a narrow sidebar')
})

test('preset filenames refer only to explicitly opened or newly saved files', async (t) => {
    const { page, service, files, dialogs, refreshPresets } = await fixture(t)
    files.set('file:///models/customizer.json', JSON.stringify({ fileFormatVersion: '1', parameterSets: { Unexpected: { field_0: '33' } } }))
    service.load('file:///models/other.scad', '/* [Global] */\nwidth=1;')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    service.load('file:///models/customizer.scad', '/* [Global] */\nfield_0=0;')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    refreshPresets()
    assert.equal(await page.locator('#preset-file').isVisible(), false)
    assert.equal(await page.locator('.preset-separator').isVisible(), false)
    assert.equal(await page.locator('#preset-select option').count(), 1)
    dialogs.names.push('Cancelled')
    await clickPresetMenu(page, 'New preset')
    await page.evaluate(() => window.sendToHost({ type: 'ready' }))
    assert.equal(files.size, 1, 'Cancelling the save dialog must not create an inferred JSON file')
    assert.equal(await page.locator('#preset-file').isVisible(), false)
    files.set('file:///models/user-picked.json', JSON.stringify({ fileFormatVersion: '1', parameterSets: { Chosen: { field_0: '7' } } }))
    await openPresetFile(page, dialogs, 'file:///models/user-picked.json')
    assert.equal(await page.locator('#preset-file').isVisible(), true)
    assert.equal(await page.locator('.preset-separator').isVisible(), true)
    await page.reload()
    await page.locator('#preset-select').waitFor()
    assert.equal(await page.locator('#preset-file').textContent(), 'user-picked.json')
})

test('preset header stays collapsed during actions and the more menu supports keyboard and dismissal', async (t) => {
    const { page } = await fixture(t)
    const section = page.locator('[data-group-kind="presets"]')
    const heading = section.locator('.group-row')
    assert.equal(await page.locator('.preset-actions button').count(), 3)
    await heading.click()
    const more = page.getByRole('button', { name: 'More preset actions', exact: true })
    await more.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menu', { name: 'More preset actions', exact: true }).waitFor()
    assert.equal(await section.getAttribute('aria-expanded'), 'false', 'Toolbar keyboard actions must not toggle the group')
    assert.equal(await page.getByRole('menuitem', { name: 'Delete preset', exact: true }).isDisabled(), true)
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.getByRole('menuitem', { name: 'Export presets', exact: true }).evaluate((button) => button === document.activeElement), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#preset-menu').isVisible(), false)
    assert.equal(await more.evaluate((button) => button === document.activeElement), true)
    await more.click()
    await page.locator('[data-group-kind="parameters"] > .group-row').first().click()
    assert.equal(await page.locator('#preset-menu').isVisible(), false)
})
