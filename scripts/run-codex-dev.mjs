import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const extension = fileURLToPath(new URL('../', import.meta.url))
const root = path.join(extension, '.build', 'codex-dev')
const port = Number(process.argv[2])
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Specify a local Extension Host debugger port.')
const workspace = process.argv[3] === undefined ? extension : path.resolve(process.argv[3])
const target = statSync(workspace, { throwIfNoEntry: false })
if (!target?.isDirectory() && !(target?.isFile() && path.extname(workspace) === '.code-workspace')) {
    throw new Error(`Expected an existing folder or .code-workspace file: ${workspace}`)
}

const listener = createServer()
await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(port, '127.0.0.1', () => listener.close(resolve))
}).catch(error => {
    if (error.code === 'EADDRINUSE') throw new Error(`Debugger port ${port} is occupied. Close the previous Codex development window before relaunching.`)
    throw error
})

const env = { ...process.env, CODEX_HOME: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex-personal') }
// The Code CLI uses this socket to forward launches back to the current workbench.
for (const key of ['VSCODE_IPC_HOOK_CLI', 'ELECTRON_RUN_AS_NODE', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID']) delete env[key]
const defaultMacExecutable = '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
const executable = process.env.SCAD_VSCODE_EXECUTABLE ?? (process.platform === 'darwin' && existsSync(defaultMacExecutable) ? defaultMacExecutable : 'code')
const child = spawn(executable, [
    '--new-window', workspace,
    `--user-data-dir=${path.join(root, 'user-data')}`,
    `--extensions-dir=${path.join(root, 'installed')}`,
    `--extensionDevelopmentPath=${extension}`,
    `--extensionDevelopmentPath=${path.join(root, 'extensions', 'openai.chatgpt')}`,
    '--disable-extensions', '--disable-extension=github.copilot-chat',
    `--inspect-extensions=${port}`,
], { env, detached: true, stdio: 'ignore' })
let failed
child.once('exit', (code, signal) => {
    if (code !== 0) failed = new Error(`VS Code exited before its debugger was ready (${signal ?? code}).`)
})
await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
child.unref()

async function waitForDebugger() {
    for (let attempt = 0; attempt < 120; attempt++) {
        if (failed) throw failed
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }).catch(() => undefined)
        if (response?.ok) return
        await setTimeout(250)
    }
    throw new Error('The isolated VS Code window did not start its Extension Host debugger.')
}

await waitForDebugger()
console.log(`Codex development Extension Host is listening on port ${port}.`)
