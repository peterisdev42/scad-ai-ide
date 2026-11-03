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
test('real Preview switches image-based CSG and full STL while advanced controls stay hidden', { skip: !executable || !cli, timeout: 120000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scad-switch-canvas-')),
        server = createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise((resolve) => server.close(resolve))
    await build({ entryPoints: ['src/test/editor/canvas.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: '.vscode-test/canvas.cjs' })
    let hostError
    const running = runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: process.cwd(), extensionTestsPath: resolve('.vscode-test/canvas.cjs'), extensionTestsEnv: { SCAD_CANVAS_TEST_DIR: directory, SCAD_OPENSCAD_CSG_EXECUTABLE: cli, SCAD_PREVIEW_EXPORTER: process.env.SCAD_PREVIEW_EXPORTER }, launchArgs: [`--user-data-dir=${join(directory, 'user')}`, `--extensions-dir=${join(directory, 'extensions')}`, `--remote-debugging-port=${port}`, '--disable-telemetry', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'] }).catch((error) => (hostError = error))
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
        const checkMeshProfile = async () => {
            const profile = await frame.locator('scad-app').evaluate((app) => app.modelContext.backend)
            for (const key of ['sourceMs', 'runtimeSelectionMs', 'meshExportMs', 'meshReadMs', 'dependenciesMs', 'cleanupMs', 'watcherMs', 'encodeMs', 'decodeMs', 'meshParseMs', 'resourcePreparationMs', 'uploadMs', 'shaderMs', 'meshSubmitMs', 'gpuCompleteMs', 'presentationMs', 'firstFrameMs', 'totalPreviewMs', 'transferSchedulingMs']) assert.ok(Number.isFinite(profile.timings[key]), key + ' must be recorded for Full Render')
            assert.equal(await frame.locator('scad-backend-status').count(), 0)
            if (process.env.SCAD_MESH_PROFILE_OUTPUT) {
                await writeFile(process.env.SCAD_MESH_PROFILE_OUTPUT, JSON.stringify(profile, null, 2) + '\n')
                await frame.locator('scad-app').screenshot({ path: process.env.SCAD_MESH_PROFILE_OUTPUT.replace(/\.json$/, '.png') })
            }
        }
        await checkMeshProfile()
        const cubeSize = () =>
            frame.locator('scad-preview').evaluate((preview) => {
                const mesh = preview.stage.modelGroup.children[0]
                mesh.geometry.computeBoundingBox()
                return mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x
            })
        assert.equal(await cubeSize(), 10)
        for (const name of ['Wireframe', 'X-Ray']) assert.equal(await frame.getByRole('switch', { name, exact: true }).count(), 0)
        await frame.locator('scad-app').evaluate((app) => {
            if (!app.panelContext.panels.sidePanel) app.panelContext.toggle('sidePanel')
        })
        const menu = await frame.locator('scad-scene-tree').evaluate((tree) => tree.shadowRoot.querySelector('vscode-context-menu').data)
        assert.ok(menu.every((item) => item.value !== 'cross-section-plane'))
        const camera = await frame.locator('scad-preview').evaluate((p) => p.stage.serializeProperties().get('camera-default'))
        for (const [name, format] of [
            ['CSG preview', 'csgp'],
            ['Full mesh render', 'stl'],
            ['CSG preview', 'csgp'],
        ]) {
            if (format === 'csgp') await frame.locator('scad-app').evaluate((app) => app.modelContext.setPreviewMode('preview'))
            else await frame.getByRole('switch', { name, exact: true }).click()
            await ready(format)
            if (format === 'csgp') {
                const scene = await frame.locator('scad-preview').evaluate((p) => p.stage.modelRepresentation.imageCsg.scene)
                assert.equal(scene.version, 'preview-scene-1')
                assert.equal(scene.bounds.max[0] - scene.bounds.min[0], 30)
                const profile = await frame.locator('scad-app').evaluate((app) => app.modelContext.backend)
                assert.ok(profile.timings.booleanPasses > 0)
                for (const key of ['sourceMs', 'selectionMs', 'runtimeMs', 'exporterMs', 'readMs', 'jsonParseMs', 'validationMs', 'conversionMs', 'dependenciesMs', 'serializationMs', 'resultParseMs', 'cleanupMs', 'watcherMs', 'encodeMs', 'decodeMs', 'viewerParseMs', 'viewerValidationMs', 'resourcePreparationMs', 'shaderMs', 'uploadMs', 'gpuWarmupMs', 'booleanSubmitMs', 'colorSubmitMs', 'gpuCompleteMs', 'presentationMs', 'firstFrameMs', 'totalPreviewMs', 'transferSchedulingMs']) assert.ok(Number.isFinite(profile.timings[key]), key + ' must be recorded')
                if (process.env.SCAD_PREVIEW_PROFILE_OUTPUT) {
                    await writeFile(process.env.SCAD_PREVIEW_PROFILE_OUTPUT, JSON.stringify(profile, null, 2) + '\n')
                    await frame.locator('scad-app').screenshot({ path: process.env.SCAD_PREVIEW_PROFILE_OUTPUT.replace(/\.json$/, '.png') })
                }
            } else {
                assert.equal(await cubeSize(), 10)
                await checkMeshProfile()
            }
            assert.deepEqual(await frame.locator('scad-preview').evaluate((p) => p.stage.serializeProperties().get('camera-default')), camera)
        }
        assert.ok((await frame.locator('canvas.main-canvas').screenshot()).length > 1000)
        assert.equal(await readFile(join(directory, 'switch.scad'), 'utf8'), 'difference(){cube($preview ? 30 : 10,center=true);cylinder(h=40,r=2,center=true,$fn=24); }\n')
    } finally {
        await writeFile(join(directory, 'done'), 'done')
        await running
        await rm(directory, { recursive: true, force: true })
    }
    if (hostError) throw hostError
})
