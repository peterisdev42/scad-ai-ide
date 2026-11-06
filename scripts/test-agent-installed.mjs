import { runTests } from '@vscode/test-electron'
import { mkdtemp, writeFile, copyFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const executable = process.env.SCAD_VSCODE_EXECUTABLE
assert.ok(executable, 'Set SCAD_VSCODE_EXECUTABLE to the installed VS Code executable.')
const vsix = path.resolve(process.argv[2] ?? '.build/scad-ai-ide-agent-parity.vsix')
const directory = await mkdtemp(path.join(os.tmpdir(), 'scad-installed-agent-'))
const profile = path.join(directory, 'profile')
const extensions = path.join(directory, 'extensions')
const testFile = path.join(directory, 'test.cjs')
const result = path.join(directory, 'result.json')
// Execute the installed host as Node for its CLI; avoids touching the user's profile.
const appRoot = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources/app') : path.resolve(path.dirname(executable), 'resources/app')
execFileSync(executable, [path.join(appRoot, 'out/cli.js'), '--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', vsix, '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' })
await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'scad-parity-smoke', publisher: 'local-test', version: '0.0.1', engines: { vscode: '^1.140.0' }, main: 'index.cjs' }))
await writeFile(path.join(directory, 'index.cjs'), 'exports.activate = () => ({})\n')
await copyFile(new URL('./fixtures/agent-installed-smoke.cjs', import.meta.url), testFile)
await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: directory, extensionTestsPath: testFile, extensionTestsEnv: { SCAD_SMOKE_EXTENSIONS_DIR: extensions, SCAD_SMOKE_RESULT: result }, launchArgs: ['--user-data-dir', profile, '--extensions-dir', extensions, '--skip-welcome', '--skip-release-notes'] })
console.log(await readFile(result, 'utf8'))
console.log(`Installed Production smoke PASS. Isolated evidence: ${directory}`)
