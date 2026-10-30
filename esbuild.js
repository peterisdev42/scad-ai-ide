const esbuild = require('esbuild')

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started')
        })
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`)
                console.error(`    ${location.file}:${location.line}:${location.column}:`)
            })
            console.log('[watch] build finished')
        })
    },
}

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        alias: { 'jsonc-parser': require.resolve('jsonc-parser/lib/esm/main.js') },
        logLevel: 'silent',
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    })
    const fs = require('node:fs/promises')
    await fs.mkdir('dist', { recursive: true })
    await fs.copyFile('node_modules/vscode-oniguruma/release/onig.wasm', 'dist/onig.wasm')
    await fs.copyFile('node_modules/manifold-3d/manifold.wasm', 'dist/manifold.wasm')
    await fs.mkdir('dist/codicons', { recursive: true })
    for (const file of ['codicon.css', 'codicon.ttf']) {
        await fs.copyFile(`node_modules/@vscode/codicons/dist/${file}`, `dist/codicons/${file}`)
    }
    const webview = await esbuild.context({
        entryPoints: ['src/features/preview/webview/index.ts'],
        tsconfig: 'tsconfig.webview.json',
        bundle: true,
        format: 'esm',
        platform: 'browser',
        outfile: 'dist/preview.js',
        minify: production,
        sourcemap: !production,
        loader: { '.stl': 'binary', '.glsl': 'text' },
        plugins: [esbuildProblemMatcherPlugin],
    })
    const customizer = await esbuild.context({
        entryPoints: ['media/customizer/main.js'],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: 'dist/customizer.js',
        minify: production,
        sourcemap: !production,
        legalComments: 'linked',
        plugins: [esbuildProblemMatcherPlugin],
    })
    const csgWorker = await esbuild.context({
        entryPoints: ['src/core/csg/worker.mts'],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: 'dist/csg-worker.mjs',
        minify: production,
        sourcemap: !production,
        legalComments: 'linked',
        plugins: [esbuildProblemMatcherPlugin],
    })
    const markdownPreview = await esbuild.context({
        entryPoints: ['src/features/preview/webview/markdown.ts'],
        tsconfig: 'tsconfig.webview.json',
        bundle: true,
        format: 'iife',
        // Markdown may reload contribution scripts when its content changes.
        banner: { js: "(()=>{if(window[Symbol.for('scad-ai-ide.markdown.viewer')]){window.dispatchEvent(new Event('scad-markdown-viewer-ready'));return;}" },
        footer: { js: '})();' },
        platform: 'browser',
        outfile: 'dist/markdown-preview.js',
        minify: production,
        sourcemap: !production,
        loader: { '.stl': 'binary', '.glsl': 'text' },
        plugins: [esbuildProblemMatcherPlugin],
    })
    if (watch) {
        await Promise.all([ctx.watch(), webview.watch(), customizer.watch(), csgWorker.watch(), markdownPreview.watch()])
    } else {
        try {
            await Promise.all([ctx.rebuild(), webview.rebuild(), customizer.rebuild(), csgWorker.rebuild(), markdownPreview.rebuild()])
        } finally {
            await Promise.all([ctx.dispose(), webview.dispose(), customizer.dispose(), csgWorker.dispose(), markdownPreview.dispose()])
        }
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
