import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, release, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { attempt, run } from '../common/io.mjs'
import { hostTarget } from '../common/target-matrix.mjs'

const frame = message => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...message })
    return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
}

export async function stdioSmoke(executable) {
    return new Promise(resolve => {
        const child = spawn(executable, ['--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], timeout: 12_000, killSignal: 'SIGKILL' })
        let buffer = Buffer.alloc(0), step = 0
        const send = message => child.stdin.write(frame(message))
        child.stdin.on('error', () => child.kill())
        child.once('error', () => resolve(false))
        child.once('close', code => resolve(code === 0 && step === 2))
        child.stdout.on('data', chunk => {
            try {
                buffer = Buffer.concat([buffer, chunk])
                if (buffer.length > 1024 * 1024) throw new Error('Excess LSP output')
                for (;;) {
                    const headerEnd = buffer.indexOf('\r\n\r\n')
                    if (headerEnd === -1) break
                    const length = Number(/^Content-Length: (\d+)\r?$/im.exec(buffer.subarray(0, headerEnd).toString())?.[1])
                    if (!length || length > 1024 * 1024) throw new Error('Invalid LSP framing')
                    const payload = headerEnd + 4
                    if (buffer.length < payload + length) break
                    const reply = JSON.parse(buffer.subarray(payload, payload + length))
                    buffer = buffer.subarray(payload + length)
                    if (step === 0 && reply.id === 1 && reply.result?.capabilities) {
                        step++
                        send({ method: 'initialized', params: {} })
                        send({ id: 2, method: 'shutdown' })
                    } else if (step === 1 && reply.id === 2 && reply.result === null) {
                        step++
                        child.stdin.end(frame({ method: 'exit' }))
                    }
                }
            } catch {
                child.kill('SIGKILL')
            }
        })
        send({ id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } })
    })
}

function vsixSmoke(root, vscode, vsix, plan, target) {
    const executable = resolve(vscode)
    const installation = dirname(executable)
    const app = platform() === 'darwin' ? resolve(installation, '../Resources/app') : resolve(installation, 'resources/app')
    let cli = join(app, 'out/cli.js')
    if (platform() === 'win32' && !existsSync(cli)) {
        // Current Windows archives place resources in a versioned directory.
        const launcher = readFileSync(join(installation, 'bin/code.cmd'), 'utf8')
        const versionedDir = /"%~dp0\.\.\\([a-f0-9]{10,40})\\resources\\app\\out\\cli\.js"/i.exec(launcher)?.[1]
        if (versionedDir) cli = join(installation, versionedDir, 'resources/app/out/cli.js')
    }
    const profile = join(root, 'profile')
    const shared = join(root, 'shared')
    const extensions = join(root, 'extensions')
    const workspace = join(root, 'workspace')
    const harness = join(root, 'harness')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(harness, { recursive: true })
    mkdirSync(join(profile, 'User'), { recursive: true })
    writeFileSync(join(profile, 'User/settings.json'), JSON.stringify({
        'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'telemetry.telemetryLevel': 'off',
    }))
    const args = ['--user-data-dir', profile, '--shared-data-dir', shared, '--extensions-dir', extensions]
    run(executable, [cli, ...args, '--install-extension', vsix, '--force'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, log: true, timeout: 120_000,
    })
    writeFileSync(join(harness, 'package.json'), JSON.stringify({
        name: 'scad-release-smoke', publisher: 'local-test', version: '1.0.0', engines: { vscode: '*' }, main: 'index.cjs',
    }))
    writeFileSync(join(harness, 'index.cjs'), 'exports.activate = () => ({})\n')
    const id = `${plan.extension.publisher}.${plan.extension.name}`
    const result = join(root, 'activated')
    const testPath = join(harness, 'smoke.cjs')
    writeFileSync(testPath, `const assert = require('node:assert/strict')
const fs = require('node:fs')
const vscode = require('vscode')
exports.run = async () => {
    assert.equal(process.platform + '-' + process.arch, ${JSON.stringify(target)})
    const extension = vscode.extensions.getExtension(${JSON.stringify(id)})
    assert.equal(extension?.packageJSON.version, ${JSON.stringify(plan.version)})
    await extension.activate()
    assert.equal(extension.isActive, true)
    fs.writeFileSync(${JSON.stringify(result)}, 'activated')
}
`)
    run(executable, [workspace, ...args, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
        `--extensionDevelopmentPath=${harness}`, `--extensionTestsPath=${testPath}`], { log: true, timeout: 120_000 })
    return result
}

export async function smokeTarget({ root, executable, target, vscode, vsix, plan }) {
    const validation = {
        compile: 'pass', 'binary-header': 'pass', 'cli-smoke': 'not-run', 'lsp-stdio': 'not-run',
        'vsix-install': 'not-run', machine: `${platform()} ${arch()} ${release()}`,
        reason: 'Target does not match this host',
    }
    if (target !== hostTarget) return validation
    const [version, help] = await Promise.all([attempt(executable, ['--version']), attempt(executable, ['--help'])])
    validation['cli-smoke'] = version.pass && /\d+\.\d+\.\d+/.test(version.stdout) &&
        help.pass && help.stdout.includes('--stdio') ? 'pass' : 'fail'
    validation['lsp-stdio'] = await stdioSmoke(executable) ? 'pass' : 'fail'
    validation.reason = vscode ? '' : 'No VS Code executable supplied'
    if (vscode) {
        try {
            const result = vsixSmoke(root, vscode, vsix, plan, target)
            // The extension host must write its own activation result.
            validation['vsix-install'] = readFileSync(result, 'utf8') === 'activated' ? 'pass' : 'fail'
        } catch (error) {
            validation['vsix-install'] = 'fail'
            validation.reason = 'VS Code install or activation failed'
            console.error(error.message)
        }
    }
    return validation
}
