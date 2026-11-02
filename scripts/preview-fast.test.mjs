import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const stl = Buffer.from('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 0 20 0\nendloop\nendfacet\nendsolid test\n').toString('base64')
let csg
let topology
let denserCsg
let browser
before(async () => {
    const worker = new Worker(join(root, 'dist/csg-worker.mjs'))
    try {
        const result = await new Promise((resolve, reject) => {
            worker.once('message', resolve)
            worker.once('error', reject)
            worker.postMessage('cube(size=[20,20,20],center=true);')
        })
        if (result.error) throw new Error(result.error)
        csg = Buffer.from(JSON.stringify(result.scene)).toString('base64')
        topology = await new Promise((resolve, reject) => {
            worker.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r.scene)))
            worker.postMessage({ topology: result.scene })
        })
        const dense = await new Promise((resolve, reject) => {
            worker.once('message', resolve)
            worker.once('error', reject)
            worker.postMessage('sphere(r=9,$fn=48);')
        })
        if (dense.error) throw new Error(dense.error)
        denserCsg = Buffer.from(JSON.stringify(dense.scene)).toString('base64')
    } finally {
        await worker.terminate()
    }
    browser = await chromium.launch({ headless: true, args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), ...(process.env.SCAD_TEST_WEBGPU === '1' ? ['--enable-unsafe-webgpu'] : [])], executablePath: process.env.SCAD_CHROMIUM_EXECUTABLE || undefined })
})
after(async () => browser?.close())

async function fixture(t, mode = 'render', deviceScaleFactor = 1) {
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
        ({ mode, csg, stl, topology, webgpu, denserCsg }) => {
            window.__scadTestWebGPU = webgpu
            if (!window.__scadTestWebGPU) Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
            window.denserCsg = denserCsg
            window.hostMessages = []
            const send = (data) => window.dispatchEvent(new MessageEvent('message', { data }))
            const update = (mode) => send({ type: 'update', format: mode === 'preview' ? 'csg' : 'stl', content: mode === 'preview' ? csg : stl })
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
        { mode, csg, stl, topology, denserCsg, webgpu: process.env.SCAD_TEST_WEBGPU === '1' },
    )
    t.after(async () => {
        await page.close()
        await new Promise((resolve) => server.close(resolve))
        assert.deepEqual(errors, [])
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('scad-app').waitFor()
    return page
}

test('CSG switching keeps the interactive Stage and camera, with mode controls immediately after projection', async (t) => {
    const page = await fixture(t)
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.serializeProperties().size > 0)
    const canvas = await page.locator('scad-preview canvas.main-canvas').boundingBox()
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(canvas.x + canvas.width / 2 + 40, canvas.y + canvas.height / 2 + 20)
    await page.mouse.up({ button: 'middle' })
    const camera = await page.locator('scad-preview').evaluate((preview) => {
        window.originalStage = preview.stage
        return preview.stage.serializeProperties().get('camera-default')
    })
    const projection = await page.getByRole('switch', { name: 'Orthographic', exact: true }).boundingBox()
    const mode = await page.getByRole('switch', { name: 'CSG preview', exact: true }).boundingBox()
    assert.ok(mode.x > projection.x && Math.abs(mode.y - projection.y) < 1)
    assert.equal(await page.locator('.preview-mode-bar').count(), 0)
    await page.getByRole('switch', { name: 'Full mesh render', exact: true }).click()
    assert.equal(await page.getByRole('switch', { name: 'Full mesh render', exact: true }).getAttribute('aria-checked'), 'true')
    for (let turn = 0; turn < 2; turn++) {
        for (const [name, format] of [
            ['CSG preview', 'csg'],
            ['Full mesh render', 'stl'],
        ]) {
            await page.getByRole('switch', { name, exact: true }).click()
            await page.waitForFunction((format) => document.querySelector('scad-app').modelContext.format === format, format)
            assert.equal(await page.getByRole('switch', { name, exact: true }).getAttribute('aria-checked'), 'true')
            assert.equal(await page.locator('scad-preview canvas.main-canvas').count(), 1)
            assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage === window.originalStage), true)
            assert.deepEqual(await page.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default')), camera)
        }
    }
    assert.equal(await page.evaluate(() => window.hostMessages.filter((message) => message.type === 'setPreviewMode').length), 5)
})

test('CSG camera drag uses interactive resolution without a per-frame readback fence, then restores full quality', async (t) => {
    const page = await fixture(t, 'preview', 2)
    await page.waitForFunction(() => {
        const preview = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')
        return preview?.stage?.csgModels?.length === 1 && preview.preparing === false && !preview.stage.csgFrameBusy
    })
    const before = await page.locator('scad-preview').evaluate((preview) => ({
        ratio: preview.stage.renderer.getPixelRatio(),
        version: preview.stage.modelGeneration,
    }))
    assert.equal(before.ratio, 2)
    await page.locator('scad-preview').evaluate((preview) => {
        const renderer = preview.stage.renderer
        const original = renderer.readRenderTargetPixelsAsync.bind(renderer)
        window.csgInteractionReadbacks = 0
        renderer.readRenderTargetPixelsAsync = (...args) => {
            window.csgInteractionReadbacks++
            return original(...args)
        }
        const pass = preview.stage.csgFramePass
        const render = pass.render.bind(pass)
        window.csgNavigationFrames = 0
        pass.render = (...args) => {
            if (args[5] === true) window.csgNavigationFrames++
            return render(...args)
        }
    })

    const canvas = await page.locator('scad-preview canvas.main-canvas').boundingBox()
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.renderer.getPixelRatio()), 2, 'Click without camera movement must not resize')
    await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width / 2 + 90, canvas.y + canvas.height / 2 + 40, { steps: 10 })
    await page.waitForFunction(() => {
        const stage = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')?.stage
        return stage?.previewNavigating && stage.renderer.getPixelRatio() === 1 && !stage.csgFrameBusy && window.csgNavigationFrames > 0 && stage.renderSignature?.startsWith('camera:')
    })
    assert.equal(await page.evaluate(() => window.csgInteractionReadbacks), 0, 'Navigation must not fence the GPU after each CSG frame')

    await page.mouse.up()
    await page.waitForFunction(() => {
        const stage = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')?.stage
        return stage && !stage.previewNavigating && stage.renderer.getPixelRatio() === 2 &&
            window.csgInteractionReadbacks > 0 && stage.renderSignature?.startsWith('[')
    })
    const after = await page.locator('scad-preview').evaluate((preview) => preview.stage.modelGeneration)
    assert.equal(after, before.version, 'Camera navigation must not regenerate the CSG scene')
})

test('complex CSG preview switches to one cached exact mesh instead of retrying over-budget raster passes', async (t) => {
    const page = await fixture(t, 'preview', 2)
    await page.waitForFunction(() => {
        const preview = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')
        return preview?.stage?.csgModels?.length === 1 && !preview.preparing && !preview.stage.csgFrameBusy
    })
    const initialVersion = await page.locator('scad-preview').evaluate((preview) => {
        const stage = preview.stage
        window.csgFallbackStatuses = []
        stage.setToolStatusCallback((status) => {
            window.csgFallbackStatuses.push(status)
            preview.toolStatus = status
        })
        // Simulate a real model's large, independently computed raster estimate.
        // The fallback must not invoke a single raster pass for this scene.
        Object.defineProperty(stage.csgModels[0], 'estimatedRasterWork', { configurable: true, value: 100000 })
        stage.maybeFallbackForRasterCost()
        return stage.modelGeneration
    })
    await page.waitForFunction(() => {
        const stage = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')?.stage
        return stage?.complexCsgFallback && stage.topologyGroup?.children.length > 0 &&
            stage.topologyGroup.visible && !stage.csgModels[0].mesh.visible
    })
    const initialTopologyQueries = await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length)
    assert.equal(initialTopologyQueries, 1, 'Exact geometry should be prepared only once')
    const canvas = await page.locator('scad-preview canvas.main-canvas').boundingBox()
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width / 2 + 45, canvas.y + canvas.height / 2 + 25, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    const state = await page.locator('scad-preview').evaluate((preview) => ({
        version: preview.stage.modelGeneration,
        fallback: preview.stage.complexCsgFallback,
        geometryVisible: preview.stage.topologyGroup?.visible,
        pixelRatio: preview.stage.renderer.getPixelRatio(),
    }))
    assert.equal(state.pixelRatio, 2, 'Cached exact meshes must retain native DPR during navigation')
    assert.equal(state.version, initialVersion, 'Camera changes must not re-run CSG preparation')
    assert.equal(state.fallback, true)
    assert.equal(state.geometryVisible, true)
    assert.deepEqual(await page.evaluate(() => window.csgFallbackStatuses.filter(Boolean)), [], 'Normal fallback must not display a status popup')
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.shadowRoot.querySelector('#tool-status') !== null), false, 'Successful fallback must not leave a notice overlay')
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length), 1)
})

test('exact-mesh fallback failure remains visible as an error', async (t) => {
    const page = await fixture(t, 'preview')
    await page.waitForFunction(() => {
        const preview = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')
        return preview?.stage?.csgModels?.length === 1 && !preview.preparing && !preview.stage.csgFrameBusy
    })
    await page.locator('scad-preview').evaluate((preview) => {
        const stage = preview.stage
        Object.defineProperty(stage.csgModels[0], 'estimatedRasterWork', { configurable: true, value: 100000 })
        stage.modelRepresentation.queryTopology = async () => {
            throw new Error('test-topology-failure')
        }
        stage.maybeFallbackForRasterCost()
    })
    await page.waitForFunction(() => {
        const preview = document.querySelector('scad-app')?.shadowRoot?.querySelector('scad-preview')
        return preview?.previewIssue?.includes('test-topology-failure') && preview.shadowRoot.querySelector('#tool-status') !== null
    })
    assert.match(await page.locator('scad-preview').evaluate((preview) => preview.previewIssue), /exact-mesh fallback failed.*test-topology-failure/i)
})

test('initial CSG preview retains host parameter/export bindings and prepares exact wireframe topology', async (t) => {
    const page = await fixture(t, 'preview')
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
    await page.locator('scad-app').evaluate((app) => {
        app.parameterContext.override('width', 30)
        app.modelContext.export()
        app.modelContext.sendToSlicer()
    })
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'parameterChanged' && m.name === 'width' && m.value === 30))
    assert.equal(await page.evaluate(() => window.hostMessages.some((m) => m.type === 'exportModel')), true)
    assert.equal(await page.evaluate(() => window.hostMessages.some((m) => m.type === 'sendToSlicer')), true)
    await page.getByRole('switch', { name: 'Wireframe', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.topologyGroup?.children.length > 0)
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length), 1)
    assert.equal(await page.getByRole('switch', { name: 'CSG preview', exact: true }).getAttribute('aria-checked'), 'true')
    await page.getByRole('switch', { name: 'Solid', exact: true }).click()
    assert.equal(await page.locator('scad-preview canvas.main-canvas').count(), 1)
})

test('native mesh previews keep their interactive viewer without SCAD mode controls', async (t) => {
    const page = await fixture(t, null)
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    assert.equal(await page.getByRole('switch', { name: 'CSG preview', exact: true }).count(), 0)
})

test('loading keeps the visible model and inactive mode resources are released when the Stage closes', async (t) => {
    const page = await fixture(t, 'preview')
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
    await page.locator('scad-preview').evaluate((preview) => {
        window.initialGeometry = preview.stage.modelGroup.children[0].geometry
        window.geometryDisposed = false
        window.initialGeometry.addEventListener('dispose', () => {
            window.geometryDisposed = true
        })
    })
    await page.evaluate(() => {
        for (let i = 0; i < 8; i++) window.dispatchEvent(new MessageEvent('message', { data: { type: 'loadingState', loading: true, message: 'Updating parameters...' } }))
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewMode', mode: 'preview' } }))
    })
    await page.locator('scad-app').evaluate((app) => app.updateComplete)
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.modelGroup.children[0].geometry === window.initialGeometry), true)
    assert.equal(await page.evaluate(() => window.geometryDisposed), false)
    await page.evaluate((content) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'stl', content } })), stl)
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.modelGroup.children[0].geometry !== window.initialGeometry)
    assert.equal(await page.evaluate(() => window.geometryDisposed), false)
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.modelGroup.children[0].geometry === window.initialGeometry), false)
    await page.locator('scad-preview').evaluate((preview) => preview.stage.dispose())
    assert.equal(await page.evaluate(() => window.geometryDisposed), true)
})

test('the evaluator, actual graphics backend and first-frame readiness remain visible', async (t) => {
    const page = await fixture(t, 'preview')
    await page.locator('scad-preview canvas.main-canvas').waitFor()
    const send = async (backend) => page.evaluate((backend) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewBackend', backend } })), backend)
    await send({ kind: 'csg', elapsedMs: 87, graphics: 'webgl2', firstFrameMs: 12, frameReady: true })
    await page.getByText('GPU CSG preview', { exact: true }).waitFor()
    assert.match(await page.locator('scad-backend-status .status').innerText(), /87 ms/)
    assert.match(await page.locator('scad-backend-status .status').innerText(), /drag updates enabled/)
    await send({ kind: 'csg', elapsedMs: 100, frameReady: false })
    assert.match(await page.locator('scad-backend-status .status').innerText(), /Waiting for the first frame/)
    await send({ kind: 'mesh', elapsedMs: 560 })
    await page.getByText('CLI mesh render', { exact: true }).waitFor()
    assert.doesNotMatch(await page.locator('scad-backend-status .status').innerText(), /non-triangular/)
})

for (const mode of ['render', 'preview'])
    test(`${mode} keeps transform, section, lighting and display tools on the shared canvas`, async (t) => {
        const page = await fixture(t, mode)
        await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
        const backend = await page.locator('scad-preview').evaluate((preview) => (preview.stage.renderer.coordinateSystem === 2001 ? 'webgpu' : 'webgl2'))
        assert.equal(backend, process.env.SCAD_TEST_WEBGPU === '1' ? 'webgpu' : 'webgl2')
        const gizmos = await page.locator('scad-preview').evaluate((preview) => {
            const stage = preview.stage
            stage.addSceneObject('cross-section-plane', 'section-tools')
            stage.setObjectVisible('section-tools', false)
            stage.setObjectProperty('section-tools', 'rotationX', 0)
            stage.setObjectProperty('section-tools', 'rotationY', 0)
            stage.setObjectProperty('section-tools', 'positionZ', 3)
            stage.selectObject('section-tools')
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
        if (mode === 'preview') {
            await page.waitForFunction(() => Math.abs(document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.csgModels[0].activePlanes[0]?.constant - 3) < 1e-9)
            const planes = await page.locator('scad-preview').evaluate((preview) => preview.stage.csgModels[0].activePlanes.map((p) => p.constant))
            assert.deepEqual(planes, [3], 'Hiding a section indicator must retain its active half-space')
        }
        await page.locator('scad-app').evaluate(async (app) => {
            const stage = app.shadowRoot.querySelector('scad-preview').stage
            stage.setActiveTool('select')
            stage.selectObject(null)
            stage.removeSceneObject('section-tools')
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

test('changing tessellation replaces shared operand buffers while retaining the raster renderer', async (t) => {
    const page = await fixture(t, 'preview')
    await page.waitForFunction(() => window.hostMessages.some((message) => message.type === 'frameReady'))
    const original = await page.locator('canvas.main-canvas').screenshot()
    await page.locator('scad-preview').evaluate((preview) => {
        window.retainedCsg = preview.stage.csgModels[0]
        window.retainedMaterial = window.retainedCsg.mesh.material
        window.originalVertexCount = window.retainedCsg.operands[0].geometry.getAttribute('position').count
    })
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'csg', content: window.denserCsg, modelVersion: 15 } })))
    await page.waitForFunction(() => window.hostMessages.some((message) => message.type === 'frameReady' && message.modelVersion === 15))
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.csgModels[0] === window.retainedCsg && preview.stage.csgModels[0].mesh.material === window.retainedMaterial), true)
    assert.equal(await page.evaluate(() => window.retainedCsg.operands[0].geometry.getAttribute('position').count > window.originalVertexCount), true)
    assert.notDeepEqual(await page.locator('canvas.main-canvas').screenshot(), original)
})

test('rapid model updates and camera motion publish only the latest prepared version', async (t) => {
    const page = await fixture(t, 'preview')
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady'))
    await page.evaluate(async () => {
        for (let i = 0; i < 6; i++) {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'csg', content: window.denserCsg, modelVersion: 40 + i } }))
            const stage = document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage
            stage.activeCameraRig.activeCamera.position.x += 0.1
            await new Promise((r) => setTimeout(r, 2))
        }
    })
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady' && m.modelVersion === 45))
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.modelRepresentation.modelVersion), 45)
    assert.equal(await page.locator('scad-preview').evaluate((preview) => preview.stage.csgModels[0].scene.operands[0].source), 'sphere')
})

test('returning to Solid keeps exact topology off the ordinary update path', async (t) => {
    const page = await fixture(t, 'preview')
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady'))
    await page.getByRole('switch', { name: 'Wireframe', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('scad-app').shadowRoot.querySelector('scad-preview').stage.topologyGroup?.children.length > 0)
    await page.getByRole('switch', { name: 'Solid', exact: true }).click()
    const requests = await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length)
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', format: 'csg', content: window.denserCsg, modelVersion: 70 } })))
    await page.waitForFunction(() => window.hostMessages.some((m) => m.type === 'frameReady' && m.modelVersion === 70))
    assert.equal(await page.evaluate(() => window.hostMessages.filter((m) => m.type === 'queryTopology').length), requests)
})
