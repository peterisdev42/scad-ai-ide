import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runner = path.join(root, 'node_modules/@vscode/test-cli/out/runner.cjs')
const executable = process.env.SCAD_VSCODE_EXECUTABLE ?? (await downloadAndUnzipVSCode(process.env.SCAD_TEST_VSCODE_VERSION ?? '1.140.0'))
const selected = process.argv[2]
if (selected && !['trusted', 'restricted'].includes(selected)) throw new Error('Expected trusted or restricted')
const fixtures = selected ? [selected] : ['trusted', 'restricted']
for (const fixture of fixtures) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'scad-feature-host-'))
    try {
        const workspace = path.join(directory, 'workspace')
        const profile = path.join(directory, 'profile')
        mkdirSync(path.join(profile, 'User'), { recursive: true })
        mkdirSync(path.join(workspace, '.vscode'), { recursive: true })
        writeFileSync(
            path.join(profile, 'User/settings.json'),
            JSON.stringify({
                'scad-ai-ide.languageServer.enabled': false,
                'security.workspace.trust.startupPrompt': 'never',
                'files.autoSave': 'off',
            }),
        )
        writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify({ 'scad-ai-ide.agent.enabled': true }))
        writeFileSync(path.join(workspace, 'model.scad'), 'cube(1);\n')
        const grep = fixture === 'trusted' ? 'installed manifest, registered LM tools|Agent model preview link|OpenSCAD export files open in Preview|AI preferences disable Agent calls|live feature and group gates|AI Panel metadata' : 'Restricted workspace capability policy'
        // test-electron always adds --disable-workspace-trust. Launch the same
        // Mocha extension runner directly so the restricted fixture is genuine.
        const result = spawnSync(executable, [workspace, '--no-sandbox', '--disable-gpu-sandbox', '--disable-extensions', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--user-data-dir', profile, '--extensions-dir', path.join(directory, 'extensions'), ...(fixture === 'trusted' ? ['--disable-workspace-trust'] : []), `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${runner}`], {
            cwd: root,
            stdio: 'inherit',
            env: {
                ...process.env,
                SCAD_TEST_RESTRICTED_FIXTURE: fixture === 'restricted' ? '1' : '0',
                VSCODE_TEST_OPTIONS: JSON.stringify({
                    mochaOpts: { grep, timeout: 30000 },
                    files: [path.join(root, 'out/test/capabilities.integration.test.js')],
                    preload: [],
                }),
            },
        })
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error(`VS Code ${fixture} fixture failed: ${result.status ?? result.signal}`)
    } finally {
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
}
