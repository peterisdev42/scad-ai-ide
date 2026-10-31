import { strToU8, zipSync } from 'fflate'
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, mkdir, copyFile, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parseCsg } from '../../core/csg/parser'
import { compileCsg, compileCsgTopology, compileMeshTopology, configureCsgWorker } from '../../core/csg/compile'
import { renderScadModel } from '../../features/markdown/ScadModelRenderer'
import type { CsgScene } from '../../core/csg/types'

let directory: string
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'scad-csg-worker-test-'))
    const worker = join(directory, 'csg-worker.mjs')
    await build({ entryPoints: [resolve('src/core/csg/worker.mts')], outfile: worker, bundle: true, platform: 'node', format: 'esm', banner: { js: "import { createRequire as scadWorkerRequireFactory } from 'node:module'; const require = scadWorkerRequireFactory(import.meta.url);" }, logLevel: 'silent' })
    await copyFile(createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm'), join(directory, 'manifold.wasm'))
    await copyFile(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz.wasm'), join(directory, 'harfbuzz.wasm'))
    await copyFile(createRequire(import.meta.url).resolve('@zkl2333/freetype-wasm/freetype.wasm'), join(directory, 'freetype.wasm'))
    await mkdir(join(directory, 'fonts'))
    await copyFile(resolve('resources/fonts/LiberationSans-Regular.ttf'), join(directory, 'fonts/LiberationSans-Regular.ttf'))
    for (const file of ['csg-kernel.mjs', 'csg-kernel.wasm']) await copyFile(resolve('resources/csg', file), join(directory, file))
    configureCsgWorker(worker)
})
after(async () => rm(directory, { recursive: true, force: true }))

async function geometry(source: string) {
    const scene = JSON.parse((await compileCsg(source)).toString()) as CsgScene
    let volume = 0
    const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
    const topology = await compileCsgTopology(scene)
    for (const mesh of topology.meshes) {
        const bytes = Buffer.from(mesh.properties, 'base64'),
            indices = Buffer.from(mesh.indices, 'base64')
        const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
        const triangles = new Uint32Array(indices.buffer, indices.byteOffset, indices.byteLength / 4)
        for (let i = 0; i < values.length; i += mesh.stride)
            for (let d = 0; d < 3; d++) {
                min[d] = Math.min(min[d], values[i + d] + (topology.origin?.[d] ?? 0))
                max[d] = Math.max(max[d], values[i + d] + (topology.origin?.[d] ?? 0))
            }
        for (let i = 0; i < triangles.length; i += 3) {
            const [a, b, c] = Array.from(triangles.slice(i, i + 3), (index) => Array.from(values.slice(index * mesh.stride, index * mesh.stride + 3)))
            volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        }
    }
    return { scene, volume, min: (topology.meshes.length ? min : scene.bounds.min).map((value) => value + 0), max: (topology.meshes.length ? max : scene.bounds.max).map((value) => value + 0) }
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
    const twist = await geometry('linear_extrude(height=10,twist=90,slices=8) square(size=[2,3]);')
    assert.ok(twist.volume > 0)
})

test('CSG color and debug/background modifiers remain visible without entering boolean operands', async () => {
    const result = await geometry('difference(){color([0.2,0.4,0.8,1]) cube(size=[10,10,10],center=false);%cube(size=[20,20,20],center=false);}')
    assert.equal(result.scene.overlays.length, 1)
    const colored = result.scene.operands.find((o) => !o.defaultColor)!
    assert.deepEqual(colored.color, [0.2, 0.4, 0.8, 1])
    const movedBackground = await geometry('multmatrix([[1,0,0,30],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) %cube(size=[2,2,2],center=false);')
    assert.deepEqual(movedBackground.min, [30, 0, 0])
    assert.deepEqual(movedBackground.max, [32, 2, 2])
    const highlight = await geometry('#cube(size=[10,10,10],center=false);')
    assert.equal(highlight.scene.overlays.length, 1)
    await assert.rejects(compileCsg('difference(){group(){} cube(size=[1,1,1]);}'), /empty/)
    await assert.rejects(compileCsg('intersection(){cube(size=[1,1,1]);group(){}}'), /empty/)
})

test('unsupported operations fail explicitly, cancellation stops the worker, and malformed inputs never execute', async () => {
    await assert.rejects(compileCsg('union(){cube(size=[1,1,1]);import(file="part.stl");}'), /ENOENT/)
    const text = await compileCsg('text(text="hello");')
    assert.equal(JSON.parse(text.toString()).version, 3)
    await assert.rejects(compileCsg('cube(size=process.exit());'), /literal CSG|Invalid CSG token/)
    const controller = new AbortController()
    const pending = compileCsg('sphere(r=100,$fn=2000);', controller.signal)
    controller.abort()
    await assert.rejects(pending, /cancelled/)
    assert.throws(() => compileCsg('cube();', controller.signal), /abort/i)
})

test('Markdown CSG transport preserves $preview and never silently invokes a mesh fallback', async () => {
    const cli = join(directory, 'cli.cjs'),
        trace = join(directory, 'trace.json')
    await writeFile(cli, `const fs=require('node:fs'); const args=process.argv.slice(2); let source=''; process.stdin.on('data',chunk=>source+=chunk); process.stdin.on('end',()=>{const format=args[args.indexOf('--export-format')+1]; const output=args[args.indexOf('-o')+1]; fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify(args)); fs.writeFileSync(output,format==='csg'?(source==='unsupported'?'future_geometry();':'cube(size=[20,20,20],center=false);'):'native mesh');});`)
    const command = { executable: process.execPath, argsPrefix: [cli, '--prefix'] }
    const signal = new AbortController().signal
    const model = JSON.parse(await renderScadModel(command, 'cube(20);', directory, signal, 'preview'))
    assert.equal(model.format, 'csg')
    assert.equal(model.backend.kind, 'csg')
    assert.equal(JSON.parse(Buffer.from(model.content, 'base64').toString()).meshes.length, 1)
    await assert.rejects(renderScadModel(command, 'unsupported', directory, signal, 'preview'), /Unsupported CSG operation: future_geometry/)
    const args = JSON.parse(await readFile(trace, 'utf8'))
    assert.ok(args.includes('$preview=true'))
    assert.ok(args.includes('csg'))
    assert.ok(!args.includes('stl'))
})

test('host resolves relative surfaces, SVG and OFF imports and records dependencies', async () => {
    const data = join(directory, 'terrain.dat')
    await writeFile(data, '1 2\n3 4\n')
    const surface = JSON.parse((await compileCsg('surface(file="terrain.dat",center=true);', undefined, { cwd: directory })).toString()) as CsgScene
    assert.equal(surface.dependencies[0].path, data)
    assert.deepEqual(surface.bounds, { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 4] })
    await writeFile(join(directory, 'shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path id="outline" d="M 0 0 L 96 0 L 96 96 L 0 96 Z"/></svg>')
    const svg = JSON.parse((await compileCsg('import(file="shape.svg",dpi=96);', undefined, { cwd: directory })).toString()) as CsgScene
    assert.ok(Math.abs(svg.bounds.max[0] - 96) < 1e-4)
    assert.ok(Math.abs(svg.bounds.min[1] + 70.6) < 1e-4)
    await writeFile(join(directory, 'surface.off'), 'OFF\n3 1 0\n0 0 0\n10 0 0\n0 10 0\n3 0 1 2\n')
    const off = JSON.parse((await compileCsg('import(file="surface.off");', undefined, { cwd: directory })).toString()) as CsgScene
    assert.equal(off.operands[0].closed, false)
    assert.ok(off.diagnostics.length)
})

test('topology queries apply result half-spaces and preserve material properties', async () => {
    const scene = JSON.parse((await compileCsg('color([.2,.4,.8,1])cube(size=[10,10,10],center=true);')).toString()) as CsgScene
    const clipped = await compileCsgTopology(scene, undefined, [{ normal: [1, 0, 0], constant: 0 }])
    const mesh = clipped.meshes[0],
        bytes = Buffer.from(mesh.properties, 'base64')
    const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
    let min = Infinity,
        max = -Infinity
    for (let i = 0; i < values.length; i += mesh.stride) {
        min = Math.min(min, values[i])
        max = Math.max(max, values[i])
        assert.ok(Math.abs(values[i + 3] - 0.2) < 1e-6)
    }
    assert.equal(min, 0)
    assert.equal(max, 5)
})

test('straight and Voronoi roof kernels produce closed local geometry and keep an outer GPU boolean', async () => {
    for (const method of ['straight', 'voronoi']) {
        const result = await geometry(`roof(method="${method}",$fn=24) square(size=[10,20]);`)
        assert.ok(Math.abs(result.volume - 416.6666667) < 0.001, `${method} ${result.volume}`)
        assert.deepEqual(result.max, [10, 20, 5])
        const nested = JSON.parse((await compileCsg(`difference(){roof(method="${method}")square(size=[10,20]);cube(size=[2,2,20]);}`)).toString()) as CsgScene
        assert.equal(nested.program[nested.root].op, 'difference')
    }
})

test('3MF import keeps physical units, materials and closed topology', async () => {
    const xml = '<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="2"><base name="red" displaycolor="#ff0000ff"/></basematerials><object id="1" type="model" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
    await writeFile(join(directory, 'colored.3mf'), zipSync({ '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'), '3D/3dmodel.model': strToU8(xml) }))
    const scene = JSON.parse((await compileCsg('import(file="colored.3mf");', undefined, { cwd: directory })).toString()) as CsgScene
    assert.ok(scene.operands[0].closed)
    assert.ok(scene.bounds.max.every((v) => Math.abs(v - 25.4) < 1e-4))
    const firstVertex = Buffer.from(scene.meshes[0].indices, 'base64').readUInt32LE(0)
    const rgba = Buffer.from(scene.meshes[0].properties, 'base64').subarray(firstVertex * scene.meshes[0].stride * 4 + 12)
    assert.equal(rgba.readFloatLE(0), 1)
    assert.equal(rgba.readFloatLE(4), 0)
    assert.equal(rgba.readFloatLE(8), 0)
    assert.equal((await compileCsgTopology(scene)).meshes.length, 1)
})

test('root tags select the first subtree before unused resources are read', async () => {
    const scene = JSON.parse((await compileCsg('import(file="absent.stl");!cube(size=[2,3,4]);!sphere(r=99);')).toString()) as CsgScene
    assert.equal(scene.operands.length, 1)
    assert.deepEqual(scene.bounds.max, [2, 3, 4])
})

test('worker cache reuses operand geometry across transform and color edits', async () => {
    const source = 'cube(size=[7,9,11]);'
    await compileCsg(source)
    const scene = JSON.parse((await compileCsg(`multmatrix([[1,0,0,50],[0,1,0,0],[0,0,1,0],[0,0,0,1]])color([1,0,0])${source}`)).toString()) as CsgScene
    assert.equal(scene.timings.geometryCacheHits, 1)
    assert.deepEqual(scene.bounds.min, [50, 0, 0])
})

test('host font directories resolve metadata instead of filenames and preserve dependencies', async () => {
    const fonts = join(directory, 'custom-fonts')
    await mkdir(fonts)
    await copyFile(resolve('resources/fonts/LiberationSans-Regular.ttf'), join(fonts, 'renamed-font.ttf'))
    const scene = JSON.parse((await compileCsg('text(text="Host",font="Liberation Sans:style=Regular");', undefined, { cwd: directory, fontDirectories: [fonts] })).toString()) as CsgScene
    assert.ok(scene.dependencies.some((d) => d.path === join(fonts, 'renamed-font.ttf')))
})

test('standard STL topology reuses existing bytes for exact clipped caps without CLI', async () => {
    const vertices = [
            [0, 0, 0],
            [10, 0, 0],
            [0, 10, 0],
            [0, 0, 10],
        ],
        faces = [
            [0, 2, 1],
            [0, 1, 3],
            [0, 3, 2],
            [1, 2, 3],
        ]
    const stl = 'solid part\n' + faces.map((face) => 'facet normal 0 0 0\nouter loop\n' + face.map((id) => 'vertex ' + vertices[id].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid part\n'
    const geometry = await compileMeshTopology(Buffer.from(stl).toString('base64'), 'stl', undefined, [{ normal: [-1, 0, 0], constant: 5 }])
    assert.equal(geometry.meshes.length, 1)
    const mesh = geometry.meshes[0],
        positions = new Float32Array(Uint8Array.from(Buffer.from(mesh.properties, 'base64')).buffer),
        indices = new Uint32Array(Uint8Array.from(Buffer.from(mesh.indices, 'base64')).buffer)
    let volume = 0,
        caps = 0
    for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((d) => Array.from(positions.slice(indices[i + d] * mesh.stride, indices[i + d] * mesh.stride + 3)))
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        if ([a, b, c].every((p) => Math.abs(p[0] + (geometry.origin?.[0] ?? 0) - 5) < 1e-6)) caps++
    }
    assert.ok(Math.abs(volume - 875 / 6) < 1e-4)
    assert.ok(caps > 0)
})

test('on-demand topology preserves small features around a large model origin', async () => {
    const result = await geometry('multmatrix([[1,0,0,1000000000],[0,1,0,0],[0,0,1,0],[0,0,0,1]])difference(){cube(size=[20,20,20],center=true);cube(size=[5,30,5],center=true);}')
    assert.deepEqual(result.min, [999999990, -10, -10])
    assert.deepEqual(result.max, [1000000010, 10, 10])
    assert.ok(Math.abs(result.volume - 7500) < 1e-6)
})
