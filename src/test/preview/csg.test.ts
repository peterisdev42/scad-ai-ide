import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, copyFile, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parseCsg } from '../../core/csg/parser'
import { compileCsg, configureCsgWorker } from '../../core/csg/compile'
import { renderScadModel } from '../../features/markdown/ScadModelRenderer'
import type { CsgScene } from '../../core/csg/types'

let directory: string
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'scad-csg-worker-test-'))
    const worker = join(directory, 'csg-worker.mjs')
    await build({ entryPoints: [resolve('src/core/csg/worker.mts')], outfile: worker, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    await copyFile(createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm'), join(directory, 'manifold.wasm'))
    configureCsgWorker(worker)
})
after(async () => rm(directory, { recursive: true, force: true }))

async function geometry(source: string) {
    const scene = JSON.parse((await compileCsg(source)).toString()) as CsgScene
    let volume = 0
    const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
    for (const mesh of scene.meshes) {
        const bytes = Buffer.from(mesh.properties, 'base64'),
            indices = Buffer.from(mesh.indices, 'base64')
        const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
        const triangles = new Uint32Array(indices.buffer, indices.byteOffset, indices.byteLength / 4)
        for (let i = 0; i < values.length; i += mesh.stride)
            for (let d = 0; d < 3; d++) {
                min[d] = Math.min(min[d], values[i + d])
                max[d] = Math.max(max[d], values[i + d])
            }
        for (let i = 0; i < triangles.length; i += 3) {
            const [a, b, c] = Array.from(triangles.slice(i, i + 3), (index) => Array.from(values.slice(index * mesh.stride, index * mesh.stride + 3)))
            volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        }
    }
    return { scene, volume, min: min.map((value) => value + 0), max: max.map((value) => value + 0) }
}

test('CSG parser accepts evaluated literals and modifiers, rejects executable expressions and excessive nesting', () => {
    const tree = parseCsg('// expanded by OpenSCAD\n%multmatrix(m=[[1,0,0,2],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) {cube(size=[2,3,4],center=true);}')
    assert.equal(tree[0].name, 'multmatrix')
    assert.equal(tree[0].modifiers, '%')
    assert.deepEqual(tree[0].children[0].params.size, [2, 3, 4])
    assert.throws(() => parseCsg('cube(size=process.exit());'), /literal CSG|Invalid CSG token/)
    assert.throws(() => parseCsg('cube(size=1+2);'), /Expected/)
    assert.throws(() => parseCsg('group(){'.repeat(300) + 'cube();' + '}'.repeat(300)), /limit/)
})

test('worker evaluates boolean geometry, holes, transforms and extrusions rather than displaying uncut operands', async () => {
    const cut = await geometry('difference(){cube(size=[20,20,20],center=true);cube(size=[10,10,30],center=true);}')
    assert.ok(Math.abs(cut.volume - 6000) < 0.01)
    assert.deepEqual(cut.min, [-10, -10, -10])
    const translated = await geometry('multmatrix([[1,0,0,30],[0,1,0,2],[0,0,1,0],[0,0,0,1]]) cube(size=[2,3,4],center=false);')
    assert.deepEqual(translated.min, [30, 2, 0])
    assert.deepEqual(translated.max, [32, 5, 4])
    const extruded = await geometry('linear_extrude(height=5,center=true,twist=0,scale=[1,1],slices=1) square(size=[2,4],center=true);')
    assert.ok(Math.abs(extruded.volume - 40) < 0.01)
    assert.deepEqual(extruded.min, [-1, -2, -2.5])
    const intersection = await geometry('intersection(){cube(size=[10,10,10],center=false);multmatrix(m=[[1,0,0,5],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) cube(size=[10,10,10],center=false);}')
    assert.ok(Math.abs(intersection.volume - 500) < 0.01)
})

test('CSG preserves the original sphere bounds and partial revolve segmentation', async () => {
    const sphere = await geometry('sphere(r=10,$fn=32,style="orig");')
    const radius = 10 * Math.cos(Math.PI / 32)
    assert.ok(sphere.max.every((value) => Math.abs(value - radius) < 0.00001))
    assert.ok(Math.abs(sphere.volume - 4121.98968) < 0.001)
    const quarter = await geometry('rotate_extrude(angle=90,start=0,$fn=32) multmatrix([[1,0,0,10],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) square(size=[2,3],center=false);')
    assert.deepEqual(quarter.min, [0, 0, 0])
    assert.deepEqual(quarter.max, [12, 12, 3])
    assert.ok(Math.abs(quarter.volume - 103.00769) < 0.001)
    await assert.rejects(compileCsg('linear_extrude(height=10,twist=90,slices=8) square(size=[2,3]);'), /Unsupported CSG operation: twisted extrusion/)
})

test('CSG color and debug/background modifiers remain visible without entering boolean operands', async () => {
    const result = await geometry('difference(){color([0.2,0.4,0.8,1]) cube(size=[10,10,10],center=false);%cube(size=[20,20,20],center=false);}')
    assert.equal(result.scene.meshes.length, 2)
    const mesh = result.scene.meshes[0]
    const bytes = Buffer.from(mesh.properties, 'base64')
    assert.equal(mesh.stride, 8)
    assert.ok(Math.abs(bytes.readFloatLE(3 * 4) - 0.2) < 0.0001)
    assert.equal(bytes.readFloatLE(7 * 4), 0)
    const movedBackground = await geometry('multmatrix([[1,0,0,30],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) %cube(size=[2,2,2],center=false);')
    assert.deepEqual(movedBackground.min, [30, 0, 0])
    assert.deepEqual(movedBackground.max, [32, 2, 2])
    const highlight = await geometry('#cube(size=[10,10,10],center=false);')
    assert.equal(highlight.scene.meshes.length, 2)
    await assert.rejects(compileCsg('difference(){group(){} cube(size=[1,1,1]);}'), /empty/)
    await assert.rejects(compileCsg('intersection(){cube(size=[1,1,1]);group(){}}'), /empty/)
})

test('unsupported operations fail explicitly, cancellation stops the worker, and malformed inputs never execute', async () => {
    await assert.rejects(compileCsg('union(){cube(size=[1,1,1]);import(file="part.stl");}'), /Unsupported CSG operation: import/)
    await assert.rejects(compileCsg('text(text="hello");'), /Unsupported CSG operation: text/)
    await assert.rejects(compileCsg('cube(size=process.exit());'), /literal CSG|Invalid CSG token/)
    const controller = new AbortController()
    const pending = compileCsg('sphere(r=100,$fn=2000);', controller.signal)
    controller.abort()
    await assert.rejects(pending, /cancelled/)
    assert.throws(() => compileCsg('cube();', controller.signal), /abort/i)
})

test('Markdown CSG transport shares the worker and falls back explicitly while preserving $preview', async () => {
    const cli = join(directory, 'cli.cjs'),
        trace = join(directory, 'trace.json')
    await writeFile(cli, `const fs=require('node:fs'); const args=process.argv.slice(2); let source=''; process.stdin.on('data',chunk=>source+=chunk); process.stdin.on('end',()=>{const format=args[args.indexOf('--export-format')+1]; const output=args[args.indexOf('-o')+1]; fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify(args)); fs.writeFileSync(output,format==='csg'?(source==='unsupported'?'text(text="x");':'cube(size=[20,20,20],center=false);'):'native mesh');});`)
    const command = { executable: process.execPath, argsPrefix: [cli, '--prefix'] }
    const signal = new AbortController().signal
    const model = JSON.parse(await renderScadModel(command, 'cube(20);', directory, signal))
    assert.equal(model.format, 'csg')
    assert.equal(model.backend.kind, 'csg')
    assert.equal(JSON.parse(Buffer.from(model.content, 'base64').toString()).meshes.length, 1)
    const fallback = JSON.parse(await renderScadModel(command, 'unsupported', directory, signal))
    assert.equal(fallback.format, 'stl')
    assert.equal(fallback.backend.kind, 'fallback')
    assert.match(fallback.backend.reason, /text/)
    assert.ok(fallback.backend.elapsedMs >= 0)
    assert.match(fallback.note, /Unsupported CSG operation: text/)
    const args = JSON.parse(await readFile(trace, 'utf8'))
    assert.ok(args.includes('$preview=true'))
    assert.ok(args.includes('stl'))
})
