const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

exports.run = async () => {
    const workspace = process.env.SCAD_OLLAMA_WORKSPACE
    const host = JSON.parse(await fs.readFile(path.join(workspace, '.build/ollama-dev/host.json'), 'utf8'))
    const result = path.join(workspace, '.build/ollama-dev/f5-smoke.json')
    await fs.rm(result, { force: true })
    await fs.rm(path.join(workspace, '.build/ollama-dev/f5-error.json'), { force: true })
    const launch = require('jsonc-parser').parse(await fs.readFile(path.join(workspace, '.vscode/launch.json'), 'utf8')).configurations.find((configuration) => configuration.name === 'Run Extension + Ollama')
    assert.ok(launch, 'Missing Ollama launch configuration')
    const args = launch.args.map((argument) => argument.replaceAll('${workspaceFolder}', workspace))
    assert.ok(args.includes('--disable-extensions'), 'Ollama debug configuration must retain --disable-extensions')
    let finish
    const done = new Promise((resolve) => { finish = resolve })
    const subscription = vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.name === 'Ollama F5 allow-list smoke') finish()
    })
    let timeout
    try {
        const started = await vscode.debug.startDebugging(undefined, {
            name: 'Ollama F5 allow-list smoke',
            type: 'extensionHost', request: 'launch',
            args: [...args, `--extensionTestsPath=${path.join(workspace, 'scripts/fixtures/ollama-dev-smoke.cjs')}`],
            env: { SCAD_OLLAMA_EXTENSIONS_DIR: host.extensions, SCAD_OLLAMA_SMOKE_RESULT: result },
            outFiles: [path.join(workspace, 'dist/**/*.js')],
            debugWebviews: false,
        })
        assert.ok(started, 'Failed to start the actual extensionHost debugger')
        await Promise.race([done, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('F5 child did not complete within 45 seconds')), 45000) })])
        const report = JSON.parse(await fs.readFile(result, 'utf8'))
        assert.equal(report.enabledNonBuiltinExtensions.length, 2)
    } catch (error) {
        await fs.writeFile(path.join(workspace, '.build/ollama-dev/f5-error.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2))
        throw error
    } finally { clearTimeout(timeout); subscription.dispose() }
}
