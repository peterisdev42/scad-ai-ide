// Keep the scope explicit. The two extension entry points and IDE-only tests
// belong to their hosts and must never be copied over one another.
export const config = {
    roots: { preview: '../vscode-openscad-preview', ide: '.' },
    trees: [
        ['src/webview', 'src/features/preview/webview'],
        ['src/shared', 'src/features/preview/shared'],
        ['src/extension', 'src/features/preview/extension'],
    ],
    files: [
        ['src/test/viewCube.test.ts', 'src/test/preview/viewCube.test.ts'],
        ['src/test/navigationAndPlate.test.ts', 'src/test/preview/navigationAndPlate.test.ts'],
    ],
    exclude: ['src/extension/index.ts', 'src/extension/services/ScadParser.test.ts'],
    // Changes here need a human decision (dependencies, entry points, adapters).
    watch: {
        preview: ['package.json', 'package-lock.json', 'esbuild.ts', 'tsconfig.base.json', 'tsconfig.extension.json', 'tsconfig.webview.json', 'src/extension/index.ts', 'src/extension/services/ScadParser.test.ts'],
        ide: ['package.json', 'package-lock.json', 'esbuild.js', 'tsconfig.json', 'tsconfig.webview.json', 'src/features/preview/registerPreview.ts', 'src/core/customizer/CustomizerParser.ts', 'src/core/customizer/CustomizerService.ts', 'src/features/runtime/registerRuntime.ts'],
    },
}
