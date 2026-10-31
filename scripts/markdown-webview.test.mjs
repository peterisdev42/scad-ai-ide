import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { runTests } from '@vscode/test-electron'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE
const waitFor = async (check, timeout = 30000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        const result = await check().catch(() => undefined)
        if (result) return result
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for the Markdown Webview.')
}

for (const owned of [false, true])
    test(`actual VS Code ${owned ? 'extension-owned' : 'built-in'} Markdown Webview mounts cached CSG previews and survives host refresh`, { skip: !executable || process.platform === 'win32', timeout: 90000 }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'scad-markdown-webview-'))
        const server = createServer()
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        const port = server.address().port
        await new Promise((resolve) => server.close(resolve))
        await build({ absWorkingDir: root, entryPoints: ['src/test/editor/markdown.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: join(root, '.vscode-test/markdown-webview.cjs') })
        let hostError
        const running = runTests({
            vscodeExecutablePath: executable,
            extensionDevelopmentPath: root,
            extensionTestsPath: join(root, '.vscode-test/markdown-webview.cjs'),
            extensionTestsEnv: { SCAD_MARKDOWN_TEST_DIR: directory, SCAD_MARKDOWN_OWNED: owned ? '1' : '0' },
            launchArgs: [`--user-data-dir=${join(directory, 'user')}`, `--extensions-dir=${join(directory, 'extensions')}`, `--remote-debugging-port=${port}`, '--disable-telemetry', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
        }).catch((error) => {
            hostError = error
        })
        try {
            const browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`))
            await waitFor(async () => readFile(join(directory, 'ready'), 'utf8'))
            const findFrame = () =>
                waitFor(async () => {
                    for (const context of browser.contexts())
                        for (const page of context.pages())
                            for (const frame of page.frames()) {
                                if ((await frame.locator('[data-scad-block]').count()) === 2 && !(await frame.evaluate(() => window.__scadRefreshPending))) return frame
                            }
                })
            let frame = await findFrame()
            let first = frame.locator('[data-scad-block]').first()
            const assertRendered = async () => {
                await first.locator('scad-preview canvas.main-canvas').waitFor({ timeout: 15000 })
                await frame.waitForFunction(() => document.querySelector('scad-app')?.shadowRoot.querySelector('scad-preview')?.stage?.modelGroup.children.length > 0)
                const box = await first.locator('canvas.main-canvas').boundingBox()
                assert.ok(box.width > 100 && box.height > 100)
                const frames = await first.locator('scad-preview').evaluate((preview) => preview.stage.renderer.info.calls)
                await new Promise((resolve) => setTimeout(resolve, 150))
                assert.ok((await first.locator('scad-preview').evaluate((preview) => preview.stage.renderer.info.calls)) >= frames)
                assert.ok(frames > 0, 'The embedded canvas must have submitted a real frame')
            }
            for (let retry = 0; ; retry++) {
                try {
                    await assertRendered()
                    break
                } catch (error) {
                    if (retry >= 3 || !/Frame was detached|Execution context was destroyed/.test(error.message)) throw error
                    frame = await findFrame()
                    first = frame.locator('[data-scad-block]').first()
                }
            }
            if (owned) {
                assert.equal(await first.locator('[data-scad-model]').evaluate((element) => JSON.parse(element.dataset.scadModel).topology), undefined, 'Fast first frame must not precompute result topology')
                const result = await first.locator('scad-app').evaluate(async (app) => {
                    const geometry = await app.modelContext.queryTopology([{ normal: [-1, 0, 0], constant: 10 }])
                    const meshes = geometry.meshes.map((mesh) => {
                        const values = new Float32Array(Uint8Array.from(atob(mesh.properties), (c) => c.charCodeAt(0)).buffer)
                        if (geometry.origin) for (let i = 0; i < values.length; i += mesh.stride) for (let d = 0; d < 3; d++) values[i + d] += geometry.origin[d]
                        return { stride: mesh.stride, values: Array.from(values) }
                    })
                    return { version: geometry.version, meshes }
                })
                assert.equal(result.version, 1)
                const x = result.meshes.flatMap((mesh) => mesh.values.filter((_, i) => i % mesh.stride === 0))
                assert.ok(x.length > 0 && Math.max(...x) <= 10.001 && Math.max(...x) >= 9.999, 'Host topology must include the clipped cap')
                await first.getByRole('switch', { name: 'Wireframe', exact: true }).click()
                await frame.waitForFunction(() => document.querySelector('scad-app')?.shadowRoot.querySelector('scad-preview')?.stage?.topologyGroup?.children.length > 0)
                await first.getByRole('switch', { name: 'Solid', exact: true }).click()
                await first.locator('canvas.main-canvas').evaluate((canvas) => (window.retainedCanvas = canvas))
            }
            await frame.evaluate(() => {
                window.__scadRefreshPending = true
                window.addEventListener(
                    'vscode.markdown.updateContent',
                    () => {
                        window.__scadRefreshPending = false
                    },
                    { once: true },
                )
            })
            await writeFile(join(directory, 'refresh'), 'refresh')
            await waitFor(() => readFile(join(directory, 'refreshed'), 'utf8'))
            frame = await findFrame()
            first = frame.locator('[data-scad-block]').first()
            await assertRendered()
            if (owned) {
                assert.equal(await first.locator('canvas.main-canvas').evaluate((canvas) => canvas === window.retainedCanvas), true, 'Unchanged Markdown models must retain the canvas')
                assert.equal(await frame.locator('#markdown-content').count(), 1)
                assert.equal(
                    await frame
                        .locator('meta[http-equiv=Content-Security-Policy]')
                        .getAttribute('content')
                        .then((value) => value.includes("worker-src 'none'")),
                    true,
                )
            }
            await first.getByRole('tab', { name: 'Source', exact: true }).click()
            assert.equal(await first.locator('pre').isVisible(), true)
            await first.getByRole('tab', { name: 'Preview', exact: true }).click()
            await assertRendered()
            if(!owned){
                for(const [name,format] of [['Full mesh render','stl'],['CSG preview','csg']]){
                    await first.getByRole('switch',{name,exact:true}).click()
                    frame=await waitFor(async()=>{
                        const candidate=await findFrame()
                        return await candidate.locator('scad-app').first().evaluate((app,format)=>app.modelContext.format===format,format)?candidate:undefined
                    })
                    first=frame.locator('[data-scad-block]').first();await assertRendered()
                }
            }

            if (owned) {
                const camera = await first.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default'))
                await first.locator('scad-app').evaluate((app) => {
                    app.viewSettingsContext.set('modelColor', '#8c51d6')
                    app.activeToolContextValue.setActiveTool('move')
                })
                for (const [mode, format] of [
                    ['render', 'stl'],
                    ['preview', 'csg'],
                ]) {
                    await first.getByRole('switch',{name:mode==='preview'?'CSG preview':'Full mesh render',exact:true}).click()
                    await frame.waitForFunction((format) => document.querySelector('scad-app')?.modelContext.format === format, format)
                    await assertRendered()
                    assert.equal(await first.locator('canvas.main-canvas').evaluate((canvas) => canvas === window.retainedCanvas), true, 'Markdown mode changes must retain the Stage canvas')
                    assert.deepEqual(await first.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default')), camera)
                    assert.equal(await first.locator('scad-app').evaluate((app) => app.viewSettingsContext.get('modelColor')), '#8c51d6')
                    assert.equal(await first.locator('scad-app').evaluate((app) => app.activeToolContextValue.activeTool), 'move')
                }
                await writeFile(join(directory, 'invalid'), 'invalid')
                await waitFor(() => readFile(join(directory, 'invalidated'), 'utf8'))
                await first.locator('.scad-markdown-status').filter({ hasText: 'Parser error' }).waitFor()
                assert.equal(await first.locator('canvas.main-canvas').evaluate((canvas) => canvas === window.retainedCanvas), true, 'Fast errors must preserve the last valid canvas')
                assert.equal(await first.locator('scad-app').evaluate((app) => app.modelContext.format), 'csg')
            }
        } finally {
            await writeFile(join(directory, 'done'), 'done')
            await running
            await rm(directory, { recursive: true, force: true })
        }
        if (hostError) throw hostError
    })
