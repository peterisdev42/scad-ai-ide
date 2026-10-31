import { build } from 'esbuild'
import { mkdir, copyFile, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'

const require = createRequire(import.meta.url),
    out = resolve(process.argv[2] ?? '.build/csg')
await mkdir(out, { recursive: true })
await build({ entryPoints: ['src/core/csg/compile.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: join(out, 'csg.cjs'), logLevel: 'warning' })
await build({ entryPoints: ['src/core/csg/worker.mts'], bundle: true, platform: 'node', format: 'esm', outfile: join(out, 'csg-worker.mjs'), banner: { js: "import { createRequire as scadWorkerRequireFactory } from 'node:module'; const require = scadWorkerRequireFactory(import.meta.url);" }, logLevel: 'warning' })
for (const [source, name] of [
    [require.resolve('manifold-3d/manifold.wasm'), 'manifold.wasm'],
    [require.resolve('harfbuzzjs/dist/harfbuzz.wasm'), 'harfbuzz.wasm'],
    [require.resolve('@zkl2333/freetype-wasm/freetype.wasm'), 'freetype.wasm'],
    ['resources/csg/csg-kernel.mjs', 'csg-kernel.mjs'],
    ['resources/csg/csg-kernel.wasm', 'csg-kernel.wasm'],
])
    await copyFile(source, join(out, name))
await cp('resources/fonts', join(out, 'fonts'), { recursive: true })
await cp('resources/csg/licenses', join(out, 'licenses'), { recursive: true })
console.log(`Built standalone CSG host library in ${out}`)
