import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { preparedTestModels } from './helpers/prepared-test-models.mjs'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const stlBytes = Buffer.alloc(134)
stlBytes.writeUInt32LE(1, 80)
for (const [index, value] of [0, 0, 1, 0, 0, 0, 20, 0, 0, 0, 20, 0].entries()) stlBytes.writeFloatLE(value, 84 + index * 4)
const stl = stlBytes.toString('base64')
let csg
let topology
let denserCsg
let complexCsg
let browser
before(async () => {
    ;({ csg, topology, denserCsg, complexCsg } = await preparedTestModels())
    browser = await chromium.launch({ headless: true, args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), ...(process.env.SCAD_TEST_WEBGPU === '1' ? ['--enable-unsafe-webgpu'] : [])], executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => browser?.close())

async function fixture(t, mode = 'render', deviceScaleFactor = 1, content = csg, partHints, expectedErrors = []) {
    const server = createServer((request, response) => {
        const path = new URL(request.url, 'http://fixture').pathname
        if (path === '/') {
            response.setHeader('Content-Type', 'text/html')
            response.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data: blob:; connect-src 'self' data: blob:; worker-src blob:;"><link id="vscode-codicon-stylesheet" rel="stylesheet" href="/dist/codicons/codicon.css"><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/preview.js"></script></body></html>`)
        } else if (path === '/theme.css') {
            response.setHeader('Content-Type', 'text/css')
            response.end('body { margin:0; height:100vh; --vscode-editor-background:#1f1f1f; --vscode-foreground:#ccc; --vscode-panel-border:#444; --vscode-focusBorder:#0078d4; --vscode-font-family:sans-serif; --vscode-font-size:13px; color:#ccc; font-family:sans-serif; font-size:13px; } #root {height:100%;}')
        } else if (/^\/dist\/(preview\.js|codicons\/codicon\.(css|ttf))$/.test(path)) {
            response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'font/ttf')
            response.end(readFileSync(join(root, path)))
        } else {
            response.statusCode = 404
            response.end()
        }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor })
    page.setDefaultTimeout(30000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
        if (message.type() === 'error' && /Shader Error|GPUValidationError|OpenSCAD Preview/.test(message.text())) errors.push(message.text())
    })
    await page.addInitScript(
        ({ mode, csg, stl, topology, webgpu, denserCsg, partHints }) => {
            window.__scadTestWebGPU = webgpu
            if (!window.__scadTestWebGPU) Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
            window.denserCsg = denserCsg
            window.hostMessages = []
            const send = (data) => window.dispatchEvent(new MessageEvent('message', { data }))
            const update = (mode) => send({ type: 'update', format: mode === 'preview' ? 'csgp' : 'stl', content: mode === 'preview' ? csg : stl })
            window.acquireVsCodeApi = () => ({
                postMessage(message) {
                    window.hostMessages.push(message)
                    if (message.type === 'ready')
                        queueMicrotask(() => {
                            if (mode) send({ type: 'previewMode', mode })
                            send({ type: 'loadScene', snapshot: null })
                            update(mode)
                            send({ type: 'updateParameters', parameters: [{ name: 'width', group: 'Parameters', type: 'number', value: 20 }], overrides: {}, parameterSets: {} })
                        })
                    if (message.type === 'setPartColors' && message.enabled && partHints) queueMicrotask(() => send({ type: 'partHints', modelVersion: message.modelVersion, hints: partHints }))
                    if (message.type === 'queryTopology') queueMicrotask(() => send({ type: 'topology', modelVersion: message.modelVersion, geometry: topology }))
                    if (message.type === 'setPreviewMode')
                        queueMicrotask(() => {
                            send({ type: 'previewMode', mode: message.mode })
                            send({ type: 'loadingState', loading: true, message: 'Generating preview...' })
                            update(message.mode)
                        })
                },
            })
        },
        { mode, csg: content, stl, topology, denserCsg, partHints, webgpu: process.env.SCAD_TEST_WEBGPU === '1' },
    )
    t.after(async () => {
        await page.close()
        await new Promise((resolve) => server.close(resolve))
        assert.equal(errors.length, expectedErrors.length)
        errors.forEach((error, index) => assert.match(error, expectedErrors[index]))
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('scad-app').waitFor()
    return page
}

test('ordinary preview exposes only basic controls and keeps the camera across model updates', async (t) => {
    const page = await fixture(t, 'render')
    await ready(page)
    for (const name of ['Solid', 'Wireframe', 'X-Ray']) assert.equal(await page.getByRole('switch', { name, exact: true }).count(), 0)
    assert.equal(await page.getByRole('switch', { name: 'Perspective', exact: true }).count(), 1)
    assert.equal(await page.getByRole('switch', { name: 'Toggle Shadows', exact: true }).count(), 1)
    await page.locator('scad-app').evaluate((app) => {
        if (!app.panelContext.panels.sidePanel) app.panelContext.toggle('sidePanel')
    })
    const menu = await page.locator('scad-scene-tree').evaluate((tree) => tree.shadowRoot.querySelector('vscode-context-menu').data)
    assert.ok(menu.every((item) => item.value !== 'cross-section-plane'))
    const camera = await page.locator('scad-preview').evaluate((preview) => {
        window.originalStage = preview.stage
        return preview.stage.serializeProperties().get('camera-default')
    })
    await page.evaluate((content) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content, modelVersion: 9 } })), stl)
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady' && m.modelVersion === 9))
    assert.equal(await page.locator('scad-preview').evaluate((p) => p.stage === window.originalStage), true)
    assert.deepEqual(await page.locator('scad-preview').evaluate((p) => p.stage.serializeProperties().get('camera-default')), camera)
    await page.locator('scad-app').evaluate((app) => app.modelContext.setPreviewMode('preview'))
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.modelContext.format === 'csgp')
    await page.locator('scad-app').evaluate((app) => app.modelContext.setPreviewMode('render'))
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.modelContext.format === 'stl')
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPreviewMode').length), 2)
})

test('native mesh previews keep their interactive viewer without SCAD mode controls', async (t) => {
    const page = await fixture(t, null)
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    assert.equal(await page.getByRole('switch', { name: 'CSG preview', exact: true }).count(), 0)
})

test('Preview combines backend, loading, tool notices and errors in one bottom-left status surface', async (t) => {
    const page = await fixture(t, 'preview')
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    const send = async (message) => page.evaluate((m) => window.dispatchEvent(new MessageEvent('message', { data: m })), message)
    await send({ type: 'previewBackend', backend: { kind: 'csg', elapsedMs: 92, graphics: 'webgpu', frameReady: true } })
    await send({ type: 'loadingState', loading: true, message: 'Updating parameters...' })
    const dock = page.locator('scad-preview #preview-status')
    await dock.getByText('Updating parameters...').waitFor()
    assert.equal(await dock.count(), 1)
    assert.equal(await page.locator('scad-app > scad-backend-status').count(), 0, 'No independently positioned backend status')
    assert.equal(await page.locator('scad-preview #loading-overlay').count(), 0, 'Progress cannot create a second bottom-left overlay')
    assert.equal(await dock.locator('scad-backend-status').count(), 0)
    await send({ type: 'previewIssue', message: 'A test rendering error occurred.' })
    await dock.getByText('A test rendering error occurred.').waitFor()
    assert.equal(await dock.locator('#tool-status').count(), 1)
    assert.equal(await dock.locator('.spinner').count(), 0)
    assert.equal(await dock.locator('scad-backend-status').count(), 0)
    await page.locator('scad-app').evaluate((app) => {
        app.modelContext = { ...app.modelContext, previewError: undefined, isLoading: false }
    })
    await page.locator('scad-preview').evaluate((preview) => preview.stage.onToolStatus?.('Measure tool: choose an edge'))
    await dock.getByText('Measure tool: choose an edge').waitFor()
    assert.equal(await dock.locator('#tool-status').count(), 0, 'Non-error tool notices must not masquerade as errors')
    assert.equal(await dock.count(), 1)
    await send({ type: 'renderError', message: 'OpenSCAD compile failed.' })
    await dock.getByText('OpenSCAD compile failed.').waitFor()
    assert.equal(await dock.getAttribute('role'), 'alert')
    assert.equal(await page.locator('scad-preview #loading-overlay').count(), 0, 'CLI errors must not use the empty-model placeholder')
    await send({ type: 'emptyModel', message: 'Model contains no solids.' })
    await page.locator('scad-preview #loading-overlay.empty').getByText('Model contains no solids.').waitFor()
    assert.equal(await dock.locator('#tool-status').count(), 0, 'The empty-model state is not a rendering error')
})

test('CSG publishes a complete pixel frame and recovers a lost device without another host render', async (t) => {
    const page = await fixture(t, 'preview')
    await page.waitForFunction(() => window.hostMessages.some((message) => message.type === 'frameReady'))
    const state = await page.locator('scad-preview').evaluate((preview) => {
        const stage = preview.stage
        window.beforeLoss = stage
        const app = document.querySelector('scad-app')
        app.sceneContextValue.addObject('cross-section-plane')
        window.recoveredPlane = app.sceneContextValue.objects.at(-1).id
        stage.setObjectProperty(window.recoveredPlane, 'positionZ', 2)
        stage.setObjectVisible(window.recoveredPlane, false)
        return { camera: stage.serializeProperties().get('camera-default'), messages: window.hostMessages.filter((m) => m.type === 'setPreviewMode').length }
    })
    const image = await page.locator('canvas.main-canvas').screenshot()
    assert.ok(image.length > 1500)
    await page.locator('scad-preview').evaluate((preview) => preview.stage.renderer.onDeviceLost({ reason: 'unknown', message: 'simulated Metal device recovery' }))
    await page.waitForFunction(() => {
        const stage = document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage
        return stage && stage !== window.beforeLoss && stage.renderer.coordinateSystem === 2000 && stage.modelGroup.children.length > 0 && window.hostMessages.filter((m) => m.type === 'frameReady').length >= 2
    })
    assert.equal(await page.evaluate(() => window.beforeLoss.disposed), true)
    assert.deepEqual(await page.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default')), state.camera)
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get(window.recoveredPlane).positionZ), 2)
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPreviewMode').length), state.messages)
    assert.equal(await page.locator('scad-preview canvas.main-canvas').count(), 1)
})

for (const mode of ['render'])
    test(`${mode} keeps light transforms and environments on the shared canvas`, async (t) => {
        const page = await fixture(t, mode)
        await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
        const backend = await page.locator('scad-preview').evaluate((preview) => (preview.stage.renderer.coordinateSystem === 2001 ? 'webgpu' : 'webgl2'))
        assert.equal(backend, process.env.SCAD_TEST_WEBGPU === '1' ? 'webgpu' : 'webgl2')
        const gizmos = await page.locator('scad-preview').evaluate((preview) => {
            const stage = preview.stage
            stage.addSceneObject('point-light', 'light-tools')
            stage.setObjectVisible('light-tools', false)
            stage.setObjectProperty('light-tools', 'rotationX', 0)
            stage.setObjectProperty('light-tools', 'rotationY', 0)
            stage.setObjectProperty('light-tools', 'positionZ', 3)
            stage.selectObject('light-tools')
            return ['move', 'rotate', 'scale'].map((tool) => {
                stage.setActiveTool(tool)
                return { mode: stage.transformControls.mode, attached: !!stage.transformControls.object }
            })
        })
        assert.deepEqual(gizmos, [
            { mode: 'translate', attached: true },
            { mode: 'rotate', attached: true },
            { mode: 'scale', attached: true },
        ])
        await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.renderer.info.calls > 1)
        await page.locator('scad-app').evaluate(async (app) => {
            const stage = app.shadowRoot.querySelector('scad-preview').stage
            stage.setActiveTool('select')
            stage.selectObject(null)
            stage.removeSceneObject('light-tools')
            for (const type of ['ambient-light', 'directional-light', 'point-light', 'spot-light']) {
                stage.addSceneObject(type, `tool-${type}`)
                stage.setObjectVisible(`tool-${type}`, false)
            }
            stage.addSceneObject('measurement', 'tool-measurement')
            for (const environment of ['grid', 'buildPlate', 'none']) {
                app.viewSettingsContext.set('environment', environment)
                await app.updateComplete
                await new Promise((resolve) => requestAnimationFrame(resolve))
            }
            for (const renderMode of ['xray', 'solid']) {
                app.viewSettingsContext.set('renderMode', renderMode)
                await app.updateComplete
                await new Promise((resolve) => requestAnimationFrame(resolve))
            }
        })
        const screenshot = await page.locator('canvas.main-canvas').screenshot()
        assert.ok(screenshot.length > 1000, 'The shared viewport must draw the model and its tools')
        assert.equal(await page.locator('scad-preview canvas.main-canvas').count(), 1)
    })

async function ready(page) {
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady'))
}

test('image-based preview navigation keeps native resolution and sends no geometry requests', async (t) => {
    const page = await fixture(t, 'preview', 2)
    await ready(page)
    const before = await page.locator('scad-preview').evaluate((p) => {
        const stage = p.stage
        window.standardDraws = 0
        const render = stage.modelRepresentation.render.bind(stage.modelRepresentation)
        stage.modelRepresentation.render = (...args) => {
            window.standardDraws++
            return render(...args)
        }
        return { requests: window.hostMessages.filter((m) => ['queryTopology', 'setPreviewMode', 'parameterChanged'].includes(m.type)).length, camera: stage.activeCameraRig.activeCamera.position.toArray() }
    })
    const box = await page.locator('canvas.main-canvas').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 130, box.y + box.height / 2 + 60, { steps: 20 })
    await page.mouse.up()
    await page.mouse.wheel(0, 200)
    const after = await page.locator('scad-preview').evaluate((p) => ({
        requests: window.hostMessages.filter((m) => ['queryTopology', 'setPreviewMode', 'parameterChanged'].includes(m.type)).length,
        camera: p.stage.activeCameraRig.activeCamera.position.toArray(),
        draws: window.standardDraws,
        ratio: p.stage.renderer.getPixelRatio(),
        csgRenderer: !!p.stage.modelRepresentation.imageCsg,
    }))
    assert.ok(after.draws >= 10)
    assert.notDeepEqual(after.camera, before.camera)
    assert.equal(after.requests, before.requests)
    assert.equal(after.ratio, 2)
    assert.equal(after.csgRenderer, true)
})

test('ordinary preview ignores saved clipping and XRay after their controls are removed', async (t) => {
    const page = await fixture(t, 'render')
    await ready(page)
    assert.equal(await page.getByRole('switch', { name: 'Wireframe', exact: true }).count(), 0)
    assert.equal(await page.getByRole('switch', { name: 'X-Ray', exact: true }).count(), 0)
    const result = await page.locator('scad-app').evaluate(async (app) => {
        app.viewSettingsContext.set('renderMode', 'xray')
        const stage = app.shadowRoot.querySelector('scad-preview').stage
        stage.addSceneObject('cross-section-plane', 'saved-section')
        await app.updateComplete
        const meshes = []
        stage.modelGroup.traverse((o) => {
            if (o.isMesh) meshes.push({ wireframe: o.material.wireframe, planes: o.material.clippingPlanes?.length ?? 0 })
        })
        return { meshes, mode: stage.materialSettings.get('renderMode'), sectionVisible: stage.handles.get('saved-section').getSceneRoot().visible }
    })
    assert.equal(result.mode, 'solid')
    assert.equal(result.sectionVisible, false)
    assert.ok(result.meshes.every((m) => !m.wireframe && m.planes === 0))
    assert.equal(await page.locator('scad-scene-tree').getByText('saved-section', { exact: true }).count(), 0)
})

test('prepared highlights and backgrounds use the same image-space Product renderer', async (t) => {
    const page = await fixture(t, 'preview', 1, complexCsg)
    await ready(page)
    const result = await page.locator('scad-preview').evaluate((p) => {
        const image = p.stage.modelRepresentation.imageCsg
        return { highlights: image.scene.highlights.length, backgrounds: image.scene.backgrounds.length, passes: image.lastTimings.booleanPasses }
    })
    assert.ok(result.highlights > 0 && result.backgrounds > 0 && result.passes > 0)
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length), 0)
})

test('parameters, exports and face picking remain live without final-mesh evaluation', async (t) => {
    const page = await fixture(t, 'preview')
    await ready(page)
    await page.locator('scad-app').evaluate((app) => {
        app.parameterContext.override('width', 30)
        app.modelContext.export()
        app.modelContext.sendToSlicer()
    })
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'parameterChanged' && m.value === 30))
    for (const type of ['exportModel', 'sendToSlicer']) assert.ok(await page.evaluate((type) => window.hostMessages.some((m) => m.type === type), type))
    const hit = await page.locator('scad-preview').evaluate((p) => {
        const ray = p.stage.raycaster
        ray.ray.origin.set(40, 0, 0)
        ray.ray.direction.set(-1, 0, 0)
        const hit = p.stage.modelRepresentation.pick(ray).value[0]
        return hit?.point.toArray()
    })
    assert.deepEqual(hit, [10, 0, 0])
    const error = await page.locator('scad-preview').evaluate((p) =>
        p.stage.modelRepresentation.queryTopology().then(
            () => '',
            (error) => error.message,
        ),
    )
    assert.match(error, /Full Render/)
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length), 0)
})

test('loading retains geometry; replacement and closing release active and cached meshes', async (t) => {
    const page = await fixture(t, 'preview')
    await ready(page)
    await page.locator('scad-preview').evaluate((p) => {
        p.stage.modelGroup.traverse((o) => {
            if (o.isMesh && !window.initialGeometry) window.initialGeometry = o.geometry
        })
        window.geometryDisposed = false
        window.initialGeometry.addEventListener('dispose', () => (window.geometryDisposed = true))
    })
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'loadingState', loading: true, message: 'Updating parameters...' } })))
    assert.equal(await page.evaluate(() => window.geometryDisposed), false)
    await page.evaluate((content) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content } })), stl)
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.modelContext.format === 'stl')
    assert.equal(await page.evaluate(() => window.geometryDisposed), false)
    await page.locator('scad-preview').evaluate((p) => p.stage.dispose())
    assert.equal(await page.evaluate(() => window.geometryDisposed), true)
})

test('rapid tessellation changes publish the latest mesh and dispose the replaced geometry', async (t) => {
    const page = await fixture(t, 'preview')
    await ready(page)
    await page.locator('scad-preview').evaluate((p) => {
        p.stage.modelGroup.traverse((o) => {
            if (o.isMesh && !window.originalMesh) window.originalMesh = o
        })
        window.geometryDisposed = false
        window.originalMesh.geometry.addEventListener('dispose', () => (window.geometryDisposed = true))
    })
    await page.evaluate(() => {
        for (let i = 0; i < 6; i++) window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'csgp', content: window.denserCsg, modelVersion: 40 + i } }))
    })
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady' && m.modelVersion === 45))
    const result = await page.locator('scad-preview').evaluate((p) => {
        let count = 0
        p.stage.modelGroup.traverse((o) => {
            if (o.isMesh) count += o.geometry.getAttribute('position').count
        })
        return { version: p.stage.modelRepresentation.modelVersion, count, disposed: window.geometryDisposed }
    })
    assert.equal(result.version, 45)
    assert.ok(result.count > 36)
    assert.equal(result.disposed, true)
})

test('standard renderer errors remain actionable and are sent to host Problems', async (t) => {
    const page = await fixture(t, 'preview', 1, csg, undefined, [/^\[OpenSCAD Preview\] Standard mesh render failed$/])
    await ready(page)
    await page.locator('scad-preview').evaluate((p) => {
        p.stage.modelRepresentation.render = () => {
            throw Error('Standard mesh render failed')
        }
        p.stage.renderFrame()
    })
    await page.getByText('Standard mesh render failed', { exact: true }).waitFor()
    await page.waitForFunction(() => window.hostMessages.some(m => m.type === 'error' && m.message === 'Standard mesh render failed'))
})

test('quick mode offers surface measurement and full mode keeps exact vertex and edge tools', async (t) => {
    const page = await fixture(t, 'preview')
    await ready(page)
    const measure = page.getByRole('switch', { name: 'Measure', exact: true })
    await measure.hover()
    assert.equal(await page.getByRole('switch', { name: 'Vertex', exact: true }).count(), 0)
    assert.equal(await page.getByRole('switch', { name: 'Edge', exact: true }).count(), 0)
    assert.equal(await page.getByRole('switch', { name: 'Face', exact: true }).count(), 1)
    await measure.click()
    const variant = await page.locator('scad-preview').evaluate((p) => p.stage.toolVariant)
    assert.equal(variant, 'face')
    assert.equal(await page.getByRole('switch', { name: 'Shadows require Full Render', exact: true }).isDisabled(), true)
    await page.locator('scad-app').evaluate((app) => app.modelContext.setPreviewMode('render'))
    await page.waitForFunction(() => document.querySelector('scad-app').modelContext.format === 'stl')
    await measure.hover()
    assert.equal(await page.getByRole('switch', { name: 'Vertex', exact: true }).count(), 1)
    assert.equal(await page.getByRole('switch', { name: 'Edge', exact: true }).count(), 1)
})

test('preview mode switches and performance panel stay hidden in both modes', async (t) => {
    for (const mode of ['render', 'preview']) {
        const page = await fixture(t, mode)
        await ready(page)
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewBackend', backend: { kind: 'csg', frameReady: true, timings: { totalPreviewMs: 123 } } } })))
        assert.equal(await page.getByRole('switch', { name: 'CSG preview', exact: true }).count(), 0)
        assert.equal(await page.getByRole('switch', { name: 'Full mesh render', exact: true }).count(), 0)
        assert.equal(await page.locator('scad-backend-status').count(), 0)
        assert.equal(await page.getByText('Performance details', { exact: true }).count(), 0)
    }
})

test('part color toggle distinguishes disconnected STL shells and restores manual colors without a host render', async (t) => {
    const page = await fixture(t, 'render')
    await ready(page)
    const bytes = Buffer.alloc(184)
    bytes.writeUInt32LE(2, 80)
    for (let part = 0; part < 2; part++) {
        const x = part * 30
        const values = [0, 0, 1, x, 0, 0, x + 20, 0, 0, x, 20, 0]
        values.forEach((value, i) => bytes.writeFloatLE(value, 84 + part * 50 + i * 4))
    }
    await page.evaluate((content) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content, modelVersion: 81 } })), bytes.toString('base64'))
    await page.waitForFunction(() => window.hostMessages.some((message) => message.type === 'frameReady' && message.modelVersion === 81))
    const toggle = page.getByRole('switch', { name: 'Color parts separately', exact: true })
    const before = await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPreviewMode').length)
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-checked'), 'true')
    const colors = await page.locator('scad-preview').evaluate((p) => {
        const mesh = p.stage.modelGroup.children[0],
            color = mesh.geometry.getAttribute('color')
        return [Array.from(color.array.slice(0, 3)), Array.from(color.array.slice(9, 12)), mesh.material.vertexColors]
    })
    assert.notDeepEqual(colors[0], colors[1])
    assert.equal(colors[2], true)
    await toggle.click()
    assert.equal(await page.locator('scad-preview').evaluate((p) => p.stage.modelGroup.children[0].geometry.hasAttribute('color')), false)
    await toggle.click()
    await page.locator('scad-toolbar').evaluate((toolbar) => {
        const input = toolbar.shadowRoot.querySelector('#model-color')
        input.value = '#ff0000'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForFunction(() => document.querySelector('scad-app').viewSettingsContext.get('partColors') === false)
    assert.equal(await page.locator('scad-preview').evaluate((p) => p.stage.modelGroup.children[0].material.color.getHexString()), 'ff0000')
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPreviewMode').length), before)
})

test('part colors also toggle on prepared Boolean previews without changing geometry', async (t) => {
    const page = await fixture(t, 'preview')
    await ready(page)
    const toggle = page.getByRole('switch', { name: 'Color parts separately', exact: true })
    const before = await page.locator('scad-preview').evaluate((p) => ({ version: p.stage.modelRepresentation.modelVersion, colors: [...p.stage.modelRepresentation.imageCsg.shade.values()].map((m) => m.color.getHexString()) }))
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('scad-app').viewSettingsContext.get('partColors') === true)
    // Wait for drawFrame to apply CSG appearance settings.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const enabled = await page.locator('scad-preview').evaluate((p) => [...p.stage.modelRepresentation.imageCsg.shade.values()].map((m) => m.color.getHexString()))
    assert.notDeepEqual(enabled, before.colors)
    await toggle.click()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const restored = await page.locator('scad-preview').evaluate((p) => ({ version: p.stage.modelRepresentation.modelVersion, colors: [...p.stage.modelRepresentation.imageCsg.shade.values()].map((m) => m.color.getHexString()) }))
    assert.deepEqual(restored, before)
})

test('CSG color assistance is requested lazily and applied without replacing the model or rendering again', async (t) => {
    const hints = [
        { id: '/0', min: [0, 0, 0], max: [1, 1, 1], color: [1, 0, 0] },
        { id: '/1', min: [1, 0, 0], max: [2, 1, 1], color: [0, 1, 0] },
    ]
    const page = await fixture(t, 'render', 1, csg, hints)
    await ready(page)
    const bytes = Buffer.alloc(184)
    bytes.writeUInt32LE(2, 80)
    for (const [part, positions] of [
        [0, [0, 0, 0, 1, 0, 0, 1, 1, 0]],
        [1, [1, 0, 0, 2, 0, 0, 1, 1, 0]],
    ]) {
        ;[0, 0, 1, ...positions].forEach((value, i) => bytes.writeFloatLE(value, 84 + part * 50 + i * 4))
    }
    await page.evaluate((content) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content, modelVersion: 91, csgPartsAvailable: true } })), bytes.toString('base64'))
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady' && m.modelVersion === 91))
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPartColors').length), 0)
    const toggle = page.getByRole('switch', { name: 'Color parts separately', exact: true })
    await page.locator('scad-preview').evaluate((p) => (window.originalModel = p.stage.modelRepresentation))
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('scad-app').modelContext.csgPartHints?.length === 2)
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.modelGroup.children[0].geometry.getAttribute('color')?.getX(0) === 1)
    const result = await page.locator('scad-preview').evaluate((p) => {
        const colors = p.stage.modelGroup.children[0].geometry.getAttribute('color')
        return { first: Array.from(colors.array.slice(0, 3)), second: Array.from(colors.array.slice(9, 12)), sameModel: p.stage.modelRepresentation === window.originalModel }
    })
    assert.deepEqual(result, { first: [1, 0, 0], second: [0, 1, 0], sameModel: true })
    await toggle.click()
    assert.equal(await page.locator('scad-preview').evaluate((p) => p.stage.modelGroup.children[0].geometry.hasAttribute('color')), false)
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('scad-app').viewSettingsContext.get('partColors') === true)
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPartColors' && m.enabled).length), 1)
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'setPreviewMode').length), 0)
})


test('invalid mesh decoding reaches host Problems with the failing model version', async t => {
    const page = await fixture(t, 'render', 1, csg, undefined, [/^\[OpenSCAD Preview\]/])
    await ready(page)
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content: btoa('invalid mesh'), modelVersion: 702 } })))
    await page.waitForFunction(() => window.hostMessages.some(m => m.type === 'error' && m.modelVersion === 702 && m.message))
    const error = await page.evaluate(() => window.hostMessages.find(m => m.type === 'error' && m.modelVersion === 702))
    assert.ok(error.message.length > 0)
})
