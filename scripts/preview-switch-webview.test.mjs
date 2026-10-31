import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { runTests } from '@vscode/test-electron'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
const executable = process.env.SCAD_VSCODE_EXECUTABLE,
    cli = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE
const waitFor = async (check) => {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
        const result = await check().catch(() => undefined)
        if (result) return result
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for the actual Preview frame.')
}
test('real Preview switches $preview geometry and reuses both modes without editing parameters', { skip: !executable || !cli, timeout: 120000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scad-switch-canvas-')),
        server = createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise((resolve) => server.close(resolve))
    await build({ entryPoints: ['src/test/editor/canvas.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: '.vscode-test/canvas.cjs' })
    let hostError
    const running = runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: process.cwd(), extensionTestsPath: resolve('.vscode-test/canvas.cjs'), extensionTestsEnv: { SCAD_CANVAS_TEST_DIR: directory, SCAD_OPENSCAD_CSG_EXECUTABLE: cli }, launchArgs: [`--user-data-dir=${join(directory, 'user')}`, `--extensions-dir=${join(directory, 'extensions')}`, `--remote-debugging-port=${port}`, '--disable-telemetry', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'] }).catch((error) => (hostError = error))
    try {
        const browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`))
        await waitFor(() => readFile(join(directory, 'ready'), 'utf8'))
        const frame = await waitFor(async () => {
            for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) if (await frame.locator('scad-app').count()) return frame
        })
        const ready = async (format) =>
            frame.waitForFunction(
                (format) => {
                    const app = document.querySelector('scad-app'),
                        preview = app?.shadowRoot.querySelector('scad-preview')
                    return app?.modelContext.format === format && app.modelContext.backend?.frameReady && preview?.stage?.modelContext?.format === format
                },
                format,
                { timeout: 45000 },
            )
        await ready('stl')
        const cubeSize = () =>
            frame.locator('scad-preview').evaluate((preview) => {
                const mesh = preview.stage.modelGroup.children[0]
                mesh.geometry.computeBoundingBox()
                return mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x
            })
        assert.equal(await cubeSize(), 10)
        const camera = await frame.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default'))
        const original = await frame.locator('canvas.main-canvas').screenshot()
        for (const [name, format, size] of [
            ['CSG preview', 'csg', 30],
            ['Full mesh render', 'stl', 10],
            ['CSG preview', 'csg', 30],
        ]) {
            await frame.getByRole('switch', { name, exact: true }).click()
            await ready(format)
            assert.equal(await cubeSize(), size)
            assert.deepEqual(await frame.locator('scad-preview').evaluate((preview) => preview.stage.serializeProperties().get('camera-default')), camera)
            if (format === 'stl') assert.equal(await frame.locator('scad-app').evaluate((app) => app.modelContext.backend.cacheHit), true)
            if (format === 'csg') assert.notDeepEqual(await frame.locator('canvas.main-canvas').screenshot(), original)
        }
        assert.equal(await readFile(join(directory, 'switch.scad'), 'utf8'), 'cube($preview ? 30 : 10,center=true);\n')
    } finally {
        await writeFile(join(directory, 'done'), 'done')
        await running
        await rm(directory, { recursive: true, force: true })
    }
    if (hostError) throw hostError
})
