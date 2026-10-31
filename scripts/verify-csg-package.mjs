import assert from 'node:assert/strict'
import { open } from 'yauzl'
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'

const archive = process.argv[2]
if (!archive) throw new Error('Usage: node scripts/verify-csg-package.mjs extension.vsix')
const directory = await mkdtemp(join(tmpdir(), 'scad-csg-package-'))
try {
    const zip = await new Promise((resolve, reject) => open(archive, { lazyEntries: true }, (error, zip) => (error ? reject(error) : resolve(zip))))
    await new Promise((done, reject) => {
        zip.on('error', reject)
        zip.on('end', done)
        zip.on('entry', (entry) => {
            if (!entry.fileName.startsWith('extension/') || entry.fileName.endsWith('/')) {
                zip.readEntry()
                return
            }
            const path = resolve(directory, entry.fileName)
            if (!path.startsWith(directory + '/')) {
                reject(new Error('Invalid archive path'))
                zip.close()
                return
            }
            zip.openReadStream(entry, (error, stream) => {
                if (error) {
                    reject(error)
                    return
                }
                const chunks = []
                stream.on('data', (data) => chunks.push(data))
                stream.on('error', reject)
                stream.on('end', () => {
                    void mkdir(dirname(path), { recursive: true })
                        .then(() => writeFile(path, Buffer.concat(chunks)))
                        .then(() => zip.readEntry(), reject)
                })
            })
        })
        zip.readEntry()
    })
    for (const path of ['dist/csg-worker.mjs', 'dist/manifold.wasm', 'dist/freetype.wasm', 'dist/harfbuzz.wasm', 'dist/csg-kernel.wasm', 'dist/csg-kernel.mjs', 'dist/markdown-owned.js', 'dist/fonts/LiberationSans-Regular.ttf', 'resources/csg/licenses/CGAL-GPL.txt', 'resources/csg/licenses/libsvg-MIT.txt', 'resources/fonts/LICENSE', 'licenses/openscad/COPYING', 'licenses/openscad-csg-source/roof.cpp.txt', 'licenses/openscad-csg-source/build-csg-kernel.mjs.txt', 'licenses/openscad-csg-source/standalone-source.zip']) await access(join(directory, 'extension', path))
    const worker = new Worker(join(directory, 'extension/dist/csg-worker.mjs'))
    try {
        const evaluate = (source) =>
            new Promise((resolve, reject) => {
                worker.once('error', reject)
                worker.once('message', (result) => (result.error ? reject(new Error(result.error)) : resolve(result.scene)))
                worker.postMessage({ source, cwd: directory })
            })
        const solid = await evaluate('difference(){cube(size=[20,20,20]);sphere(r=8,$fn=16);}')
        assert.equal(solid.version, 2)
        assert.equal(solid.operands.length, 2)
        const text = await evaluate('text(text="Package",size=10,font="Liberation Sans");')
        assert.ok(text.triangleCount > 0)
        const roof = await evaluate('roof(method="voronoi")square(size=[10,20]);')
        assert.ok(roof.triangleCount > 0)
    } finally {
        await worker.terminate()
    }
    console.log('VSIX CSG smoke check passed: isolated operands, fonts, local roof WASM and licenses.')
} finally {
    await rm(directory, { recursive: true, force: true })
}
