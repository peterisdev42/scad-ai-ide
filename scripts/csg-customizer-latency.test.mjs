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
        await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('Timed out waiting for the Customizer preview.')
}
test('real VS Code Customizer input reaches a presented CSG frame through CLI, worker and Webview', { skip: !executable || !cli, timeout: 120000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scad-customizer-latency-')),
        server = createServer()
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    await new Promise((r) => server.close(r))
    await build({ entryPoints: ['src/test/editor/canvas.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: '.vscode-test/canvas.cjs' })
    let hostError
    const running = runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: process.cwd(), extensionTestsPath: resolve('.vscode-test/canvas.cjs'), extensionTestsEnv: { SCAD_CANVAS_TEST_DIR: directory, SCAD_OPENSCAD_CSG_EXECUTABLE: cli, SCAD_CANVAS_CUSTOMIZER_BENCH: '1' }, launchArgs: [`--user-data-dir=${join(directory, 'user')}`, `--extensions-dir=${join(directory, 'extensions')}`, `--remote-debugging-port=${port}`, '--disable-telemetry', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'] }).catch((e) => (hostError = e))
    try {
        const browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`))
        await waitFor(() => readFile(join(directory, 'ready'), 'utf8'))
        const frame = await waitFor(async () => {
            for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) if (await frame.locator('scad-app').count()) return frame
        })
        await frame.waitForFunction(() => document.querySelector('scad-app')?.modelContext?.backend?.frameReady)
        const samples = []
        for (let i = 0; i < 10; i++) {
            const value = 31 + i
            await writeFile(join(directory, 'parameter.json'), JSON.stringify({ id: i, value }))
            const start = await waitFor(async () => {
                const result = JSON.parse(await readFile(join(directory, 'parameter-start.json'), 'utf8'))
                return result.id === i ? result : undefined
            })
            assert.equal(start.continuous, true)
            await frame.waitForFunction((value) => {
                const app = document.querySelector('scad-app'),
                    stage = app?.shadowRoot.querySelector('scad-preview')?.stage
                const data = stage?.csgModels[0]?.scene
                return app?.modelContext.backend?.frameReady && data && Math.abs(data.bounds.max[0] - data.bounds.min[0] - value) < 1e-6
            }, value)
            const result = await frame.locator('scad-preview').evaluate((preview, start) => ({ latencyMs: Date.now() - start, backend: preview.stage.renderer.coordinateSystem === 2001 ? 'webgpu' : 'webgl2', width: preview.stage.renderer.domElement.width, height: preview.stage.renderer.domElement.height, modelVersion: preview.stage.modelRepresentation.modelVersion }), start.started)
            samples.push({ value, vscodeVersion: start.vscodeVersion, ...result })
        }
        const times = samples.map((s) => s.latencyMs).sort((a, b) => a - b),
            quantile = (p) => {
                const i = (times.length - 1) * p,
                    low = Math.floor(i)
                return times[low] + (times[Math.ceil(i)] - times[low]) * (i - low)
            }
        const report = { browser: browser.version(), note: 'CustomizerService.set(width, value, input) in the real extension host → actual CLI → worker → VS Code Webview → GPU completion → two rAF → host frameReady acknowledgement. Includes the acknowledgement/polling overhead, not DOM gesture dispatch. Ten uncached dimension changes; actual canvas dimensions are recorded per sample.', p50Ms: quantile(0.5), p95Ms: quantile(0.95), samples }
        if (process.env.SCAD_CUSTOMIZER_REPORT) await writeFile(process.env.SCAD_CUSTOMIZER_REPORT, JSON.stringify(report, null, 2) + '\n')
        assert.ok(samples.every((s) => s.modelVersion > 0))
    } finally {
        await writeFile(join(directory, 'done'), 'done')
        await running
        await rm(directory, { recursive: true, force: true })
    }
    if (hostError) throw hostError
})
