import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
    version: process.env.SCAD_TEST_VSCODE_VERSION ?? '1.140.0',
    files: ['out/test/mesh.integration.test.js', 'out/test/cad.integration.test.js', 'out/test/capabilities.integration.test.js', 'out/test/extension.test.js', 'out/test/language.integration.test.js', 'out/test/markdown.integration.test.js', 'out/test/libraries.integration.test.js'],
    useInstallation: process.env.SCAD_VSCODE_EXECUTABLE ? { fromPath: process.env.SCAD_VSCODE_EXECUTABLE } : undefined,
    launchArgs: [...(process.env.SCAD_TEST_TRUSTED_FIXTURE === '1' ? ['--disable-workspace-trust'] : []), ...(process.env.SCAD_TEST_WORKSPACE ? [process.env.SCAD_TEST_WORKSPACE] : []), ...(process.env.SCAD_TEST_USER_DATA ? ['--user-data-dir', process.env.SCAD_TEST_USER_DATA] : []), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    mocha: { timeout: 30000 },
})
