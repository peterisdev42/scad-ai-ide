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

test('actual VS Code Markdown Webview mounts cached CSG previews and survives host refresh', { skip: !executable || process.platform === 'win32', timeout: 90000 }, async () => {
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
        extensionTestsEnv: { SCAD_MARKDOWN_TEST_DIR: directory },
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
            const frames = await first.locator('scad-preview').evaluate((preview) => preview.stage.renderer.info.render.frame)
            await new Promise((resolve) => setTimeout(resolve, 150))
            assert.ok((await first.locator('scad-preview').evaluate((preview) => preview.stage.renderer.info.render.frame)) > frames)
        }
        await assertRendered()
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
        await first.getByRole('tab', { name: 'Source', exact: true }).click()
        assert.equal(await first.locator('pre').isVisible(), true)
        await first.getByRole('tab', { name: 'Preview', exact: true }).click()
        await assertRendered()
    } finally {
        await writeFile(join(directory, 'done'), 'done')
        await running
        await rm(directory, { recursive: true, force: true })
    }
    if (hostError) throw hostError
})
