import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, OrthographicCamera, Raycaster, Vector2 } from 'three'
import { previewFixture } from './helpers/prepared-preview-fixture.mjs'
test('exporter products produce real Boolean holes on WebGPU and WebGL2', { timeout: 180000 }, async () => {
    const fixture = await previewFixture()
    try {
        for (const forceWebGL of [false, true]) {
            const page = await fixture.browser.newPage()
            const errors = []
            page.on('pageerror', (e) => errors.push(e.message))
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text())
            })
            await page.goto(fixture.url)
            await page.waitForFunction(() => typeof window.testModel === 'function')
            for (const name of ['cube', 'sphere', 'cylinder', 'transform', 'difference', 'intersection', 'nested', 'union', 'polygon', 'largeBoolean', 'separatedLarge', 'coplanar', 'thin', 'concaveLayers']) {
                const scene = await fixture.scene(name),
                    focus = name === 'separatedLarge' ? [1000000013.25, 0, 0] : scene.origin,
                    result = await page.evaluate(({ scene, forceWebGL, focus }) => window.testModel(scene, forceWebGL, focus), { scene, forceWebGL, focus })
                assert.equal(result.backend, forceWebGL ? 'webgl2' : 'webgpu')
                const alpha = (x, y) => result.pixels[(y * 128 + x) * 4 + 3]
                assert.deepEqual(errors, [])
                assert.ok(
                    result.pixels.some((v, i) => i % 4 === 3 && v > 0),
                    name + ' must have visible surfaces',
                )
                if (name === 'difference' || name === 'nested') assert.equal(alpha(64, 64), 0, name + ' must expose the actual central hole')
                if (name === 'cube' || name === 'intersection') assert.ok(alpha(64, 64) > 0, name + ' must cover the center')
                assert.equal(alpha(0, 0), 0, 'outside must remain empty')
                let mismatches = 0,
                    samples = 0
                for (let y = 7; y < 128; y += 11)
                    for (let x = 5; x < 128; x += 11) {
                        const wx = ((x + 0.5) / 128) * 32 - 16,
                            wy = (((y + 0.5) / 128) * 32 - 16) * (forceWebGL ? 1 : -1)
                        const expected = fixture.tracePreview(scene, [wx + focus[0], wy + focus[1], 100 + focus[2]], [0, 0, -1]).length > 0
                        if (alpha(x, y) > 0 !== expected) mismatches++
                        samples++
                    }
                assert.equal(mismatches, 0, `${name} ${result.backend}: all ${samples} interior/exterior samples must match CPU product queries`)

                console.log(name, result.backend, Math.round(result.gpu.uploadMs), Math.round(result.renderMs))
            }
            assert.deepEqual(errors, [])
            await page.close()
        }
    } finally {
        await fixture.close()
    }
})

test('Goldfeather parity works under orbit, perspective, multiple layers, and a camera inside a subtraction', { timeout: 180000 }, async () => {
    const fixture = await previewFixture()
    try {
        for (const forceWebGL of [false, true]) {
            const page = await fixture.browser.newPage(),
                errors = []
            page.on('pageerror', (e) => errors.push(e.message))
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text())
            })
            await page.goto(fixture.url)
            await page.waitForFunction(() => window.testModel)
            const cases = [
                ['difference', { perspective: true, position: [35, -40, 28], target: [0, 0, 0], up: [0, 0, 1] }],
                ['nested', { perspective: true, position: [-30, 35, 22], target: [0, 0, 0], up: [0, 0, 1] }],
                ['concaveLayers', { perspective: true, position: [40, -25, 15], target: [0, 0, 0], up: [0, 0, 1] }],
                ['concaveLayers', { position: [100, 0, 0], target: [0, 0, 0], up: [0, 0, 1] }],
                ['difference', { perspective: true, position: [0, 0, 0], target: [10, 0, 0], up: [0, 0, 1] }],
            ]
            for (const [name, pose] of cases) {
                const scene = await fixture.scene(name),
                    result = await page.evaluate(({ scene, forceWebGL, pose }) => window.testModel(scene, forceWebGL, scene.origin, pose), { scene, forceWebGL, pose })
                const camera = pose.perspective ? new PerspectiveCamera(50, 1, 0.1, 500) : new OrthographicCamera(-16, 16, 16, -16, 0.1, 200)
                camera.position.set(...pose.position)
                camera.up.set(...pose.up)
                camera.lookAt(...pose.target)
                camera.updateMatrixWorld()
                const ray = new Raycaster()
                let mismatches = 0
                for (let y = 7; y < 128; y += 11)
                    for (let x = 5; x < 128; x += 11) {
                        ray.setFromCamera(new Vector2((x + 0.5) / 64 - 1, ((y + 0.5) / 64 - 1) * (forceWebGL ? 1 : -1)), camera)
                        const expected = fixture.tracePreview(scene, ray.ray.origin.toArray(), ray.ray.direction.toArray()).some((hit) => hit.distance >= camera.near && hit.distance <= camera.far)
                        const visible = result.pixels[(y * 128 + x) * 4 + 3] > 0
                        if (visible !== expected) mismatches++
                    }
                assert.equal(mismatches, 0, `${name} ${result.backend} ${JSON.stringify(pose)} must match all Product ray queries`)
            }
            assert.deepEqual(errors, [])
            await page.close()
        }
    } finally {
        await fixture.close()
    }
})

test('image-space rendering preserves RGBA and empty prepared scenes on both backends', { timeout: 120000 }, async () => {
    const fixture = await previewFixture()
    try {
        for (const forceWebGL of [false, true]) {
            const page = await fixture.browser.newPage()
            await page.goto(fixture.url)
            await page.waitForFunction(() => window.testModel)
            const scene = await fixture.scene('cube')
            scene.instances[0].defaultColor = false
            scene.instances[0].color = [0.2, 0.4, 0.8, 0.7]
            const result = await page.evaluate(({ scene, forceWebGL }) => window.testModel(scene, forceWebGL, scene.origin, { override: false }), { scene, forceWebGL })
            const pixel = result.pixels.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4)
            assert.ok(pixel[0] > 0 && pixel[2] > pixel[0], JSON.stringify(pixel) + ' must preserve blue source colour')
            assert.ok(pixel[3] > 0 && pixel[3] < 255, 'source alpha must remain transparent')
            const empty = await fixture.scene('empty'),
                blank = await page.evaluate(({ scene, forceWebGL }) => window.testModel(scene, forceWebGL, scene.origin), { scene: empty, forceWebGL })
            assert.ok(blank.pixels.every((v, i) => i % 4 !== 3 || v === 0))
            await page.close()
        }
    } finally {
        await fixture.close()
    }
})

test('native raster depth equality leaves no pinholes across oblique Boolean surfaces', { timeout: 180000 }, async () => {
    const fixture = await previewFixture()
    try {
        for (const forceWebGL of [false, true]) {
            const page = await fixture.browser.newPage()
            await page.goto(fixture.url)
            await page.waitForFunction(() => window.testModel)
            for (const name of ['difference', 'intersection']) {
                const scene = await fixture.scene(name)
                const pose = { antialias: true, perspective: true, position: [35, -40, 28], target: [0, 0, 0], up: [0, 0, 1] }
                const result = await page.evaluate(({ scene, forceWebGL, pose }) => window.testModel(scene, forceWebGL, scene.origin, pose), { scene, forceWebGL, pose })
                const camera = new PerspectiveCamera(50, 1, 0.1, 500)
                camera.position.set(...pose.position)
                camera.up.set(...pose.up)
                camera.lookAt(...pose.target)
                camera.updateMatrixWorld()
                const ray = new Raycaster()
                let missing = 0,
                    extra = 0
                for (let y = 0; y < 128; y++)
                    for (let x = 0; x < 128; x++) {
                        ray.setFromCamera(new Vector2((x + 0.5) / 64 - 1, ((y + 0.5) / 64 - 1) * (forceWebGL ? 1 : -1)), camera)
                        const expected = fixture.tracePreview(scene, ray.ray.origin.toArray(), ray.ray.direction.toArray()).length > 0
                        const visible = result.pixels[(y * 128 + x) * 4 + 3] > 0
                        if (expected && !visible) missing++
                        if (!expected && visible) extra++
                    }
                assert.equal(missing, 0, `${name} ${result.backend}: no missing surface pixels`)
                assert.equal(extra, 0, `${name} ${result.backend}: no extra surface pixels`)
            }
            await page.close()
        }
    } finally {
        await fixture.close()
    }
})
