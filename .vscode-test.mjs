import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
    files: ['out/test/extension.test.js', 'out/test/language.integration.test.js'],
    useInstallation: process.env.SCAD_VSCODE_EXECUTABLE ? { fromPath: process.env.SCAD_VSCODE_EXECUTABLE } : undefined,
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    mocha: { timeout: 30000 },
})
