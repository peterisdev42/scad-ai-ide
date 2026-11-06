import { runTests } from '@vscode/test-electron'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import './prepare-ollama-dev.mjs'

const executable = process.env.SCAD_VSCODE_EXECUTABLE
assert.ok(executable, 'Set SCAD_VSCODE_EXECUTABLE to the installed VS Code executable.')
const workspace = fileURLToPath(new URL('../', import.meta.url))
const host = JSON.parse(await readFile(path.join(workspace, '.build', 'ollama-dev', 'host.json')))
const result = path.join(workspace, '.build', 'ollama-dev', 'smoke.json')
await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: [workspace, host.ollamaExtension],
    extensionTestsPath: path.join(workspace, 'scripts', 'fixtures', 'ollama-dev-smoke.cjs'),
    extensionTestsEnv: { SCAD_OLLAMA_EXTENSIONS_DIR: host.extensions, SCAD_OLLAMA_SMOKE_RESULT: result },
    launchArgs: ['--user-data-dir', path.join(workspace, '.build', 'ollama-dev', 'smoke-user-data'), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
})
console.log(await readFile(result, 'utf8'))

// Exercise VS Code's actual F5 debugger route as well as standalone process launch.
// A sentinel installed extension must stay disabled in the child host.
const sentinelRoot = path.join(workspace, '.build', 'ollama-dev', 'f5-extensions', 'scad-test.unexpected-smoke-extension')
const { mkdir, writeFile } = await import('node:fs/promises')
await mkdir(sentinelRoot, { recursive: true })
await writeFile(path.join(sentinelRoot, 'package.json'), JSON.stringify({ name: 'unexpected-smoke-extension', publisher: 'scad-test', version: '0.0.1', engines: { vscode: '^1.140.0' }, activationEvents: ['*'], main: 'index.cjs' }))
await writeFile(path.join(sentinelRoot, 'index.cjs'), 'exports.activate = () => ({})\n')
const driverRoot = path.join(workspace, '.build', 'ollama-dev', 'f5-driver')
await mkdir(driverRoot, { recursive: true })
await writeFile(path.join(driverRoot, 'package.json'), JSON.stringify({ name: 'f5-driver', publisher: 'scad-test', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: 'index.cjs' }))
await writeFile(path.join(driverRoot, 'index.cjs'), 'exports.activate = () => ({})\n')
await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: driverRoot,
    extensionTestsPath: path.join(workspace, 'scripts', 'fixtures', 'ollama-f5-driver.cjs'),
    extensionTestsEnv: { SCAD_OLLAMA_WORKSPACE: workspace },
    launchArgs: ['--user-data-dir', path.join(workspace, '.build', 'ollama-dev', 'f5-user-data'), '--extensions-dir', path.dirname(sentinelRoot), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
})
console.log('Actual F5 debugger allow-list smoke:')
console.log(await readFile(path.join(workspace, '.build', 'ollama-dev', 'f5-smoke.json'), 'utf8'))
