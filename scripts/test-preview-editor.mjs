import { build } from 'esbuild'
import { runTests } from '@vscode/test-electron'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = process.env.SCAD_VSCODE_EXECUTABLE
if (!executable) throw new Error('Set SCAD_VSCODE_EXECUTABLE to your Code OSS executable or scripts/code.sh.')
const profile = await mkdtemp(path.join(tmpdir(), 'scad-editor-profile-'))
try {
    await build({
        absWorkingDir: root,
        entryPoints: ['src/test/editor/index.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['vscode'],
        outfile: '.vscode-test/editor.cjs',
    })
    await runTests({
        vscodeExecutablePath: path.resolve(executable),
        extensionDevelopmentPath: root,
        extensionTestsPath: path.join(root, '.vscode-test/editor.cjs'),
        launchArgs: [`--user-data-dir=${path.join(profile, 'user')}`, `--extensions-dir=${path.join(profile, 'extensions')}`, '--disable-telemetry', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    })
} finally {
    await rm(profile, { recursive: true, force: true })
}
