const esbuild = require('esbuild')

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')
const bundledPackages = new Set()

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.initialOptions.metafile = true
        build.onStart(() => {
            console.log('[watch] build started')
        })
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`)
                console.error(`    ${location.file}:${location.line}:${location.column}:`)
            })
            for (const input of Object.keys(result.metafile?.inputs ?? {})) {
                const matches = [...input.matchAll(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+/g)]
                if (matches.length) bundledPackages.add(input.slice(0, matches[matches.length - 1].index + matches[matches.length - 1][0].length))
            }
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
    await fs.copyFile(require.resolve('harfbuzzjs/dist/harfbuzz.wasm'), 'dist/harfbuzz.wasm')
    await fs.copyFile(require.resolve('@zkl2333/freetype-wasm/freetype.wasm'), 'dist/freetype.wasm')
    for (const file of ['csg-kernel.mjs', 'csg-kernel.wasm']) await fs.copyFile(`resources/csg/${file}`, `dist/${file}`)
    await fs.mkdir('dist/fonts', { recursive: true })
    for (const file of await fs.readdir('resources/fonts')) await fs.copyFile(`resources/fonts/${file}`, `dist/fonts/${file}`)
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
        banner: { js: "import { createRequire as scadWorkerRequireFactory } from 'node:module'; const require = scadWorkerRequireFactory(import.meta.url);" },
        minify: production,
        sourcemap: !production,
        legalComments: 'linked',
        plugins: [esbuildProblemMatcherPlugin],
    })
    const markdownPreview = await esbuild.context({
        entryPoints: ['src/features/preview/webview/markdown-entry.ts'],
        tsconfig: 'tsconfig.webview.json',
        bundle: true,
        format: 'iife',
        // Markdown may reload contribution scripts when its content changes.
        banner: { js: "(()=>{if(window[Symbol.for('scad-ai-ide.markdown.viewer.v2')]){window.dispatchEvent(new Event('scad-markdown-viewer-ready'));return;}" },
        footer: { js: '})();' },
        platform: 'browser',
        outfile: 'dist/markdown-preview.js',
        minify: production,
        sourcemap: !production,
        loader: { '.stl': 'binary', '.glsl': 'text' },
        plugins: [esbuildProblemMatcherPlugin],
    })
    const markdownOwned = await esbuild.context({
        entryPoints: ['src/features/preview/webview/markdown-owned.ts'],
        tsconfig: 'tsconfig.webview.json',
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: 'dist/markdown-owned.js',
        minify: production,
        sourcemap: !production,
        loader: { '.stl': 'binary', '.glsl': 'text' },
        plugins: [esbuildProblemMatcherPlugin],
    })
    if (watch) {
        await Promise.all([ctx.watch(), webview.watch(), customizer.watch(), csgWorker.watch(), markdownPreview.watch(), markdownOwned.watch()])
    } else {
        try {
            await Promise.all([ctx.rebuild(), webview.rebuild(), customizer.rebuild(), csgWorker.rebuild(), markdownPreview.rebuild(), markdownOwned.rebuild()])
            await fs.writeFile('dist/bundled-packages.json', JSON.stringify([...bundledPackages].sort(), null, 2) + '\n')
        } finally {
            await Promise.all([ctx.dispose(), webview.dispose(), customizer.dispose(), csgWorker.dispose(), markdownPreview.dispose(), markdownOwned.dispose()])
        }
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
