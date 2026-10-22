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
        logLevel: 'silent',
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    })
    const fs = require('node:fs/promises')
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
    if (watch) {
        await Promise.all([ctx.watch(), webview.watch()])
    } else {
        try {
            await Promise.all([ctx.rebuild(), webview.rebuild()])
        } finally {
            await Promise.all([ctx.dispose(), webview.dispose()])
        }
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
