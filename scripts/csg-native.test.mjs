import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { Worker } from 'node:worker_threads'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'

const executable = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE || process.env.SCAD_OPENSCAD_EXECUTABLE
function worker(request) {
    const w = new Worker(new URL('../dist/csg-worker.mjs', import.meta.url))
    return new Promise((resolve, reject) => {
        w.once('error', reject)
        w.once('message', (r) => {
            void w.terminate()
            r.error ? reject(new Error(r.error)) : resolve(r.scene)
        })
        w.postMessage(request)
    })
}
function stats(positions, stride, indices) {
    let volume = 0
    const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i += stride)
        for (let d = 0; d < 3; d++) {
            min[d] = Math.min(min[d], positions[i + d])
            max[d] = Math.max(max[d], positions[i + d])
        }
    for (let i = 0; i < (indices?.length ?? positions.length / stride); i += 3) {
        const [a, b, c] = [0, 1, 2].map((d) => Array.from(positions.slice((indices?.[i + d] ?? i + d) * stride, (indices?.[i + d] ?? i + d) * stride + 3)))
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
    return { min, max, volume }
}
const cases = {
    hullOpenSurface: 'hull(){polyhedron(points=[[0,0,0],[10,0,0],[0,10,0]],faces=[[0,1,2]]);translate([0,0,8])polyhedron(points=[[0,0,0],[10,0,0],[0,10,0]],faces=[[0,1,2]]);}',
    concavePolyhedron: 'polyhedron(points=[[0,0,0],[6,0,0],[6,2,0],[2,2,0],[2,6,0],[0,6,0],[0,0,4],[6,0,4],[6,2,4],[2,2,4],[2,6,4],[0,6,4]],faces=[[0,1,2,3,4,5],[11,10,9,8,7,6],[6,7,1,0],[7,8,2,1],[8,9,3,2],[9,10,4,3],[10,11,5,4],[11,6,0,5]]);',
    polygonContours: 'linear_extrude(3)polygon(points=[[0,0],[20,0],[20,20],[10,10],[0,20],[3,3],[7,3],[7,7],[3,7]],paths=[[0,1,2,3,4],[5,6,7,8]]);',
    scaledTwist: 'linear_extrude(height=12,center=true,twist=120,slices=10,segments=12,scale=[.5,1.5],convexity=4)translate([5,0])square([3,4]);',
    autoScaleTwist: 'linear_extrude(height=12,twist=120,scale=.3,$fa=15,$fs=1)translate([5,0])square([3,4]);',
    projectionCut: 'linear_extrude(2)projection(cut=true)translate([0,0,-5])rotate([30,10,0])cube(10);',
    fill: 'linear_extrude(2)fill()difference(){square(20);translate([4,4])square(5);}',
    chamferOffset: 'linear_extrude(2)offset(delta=2,chamfer=true)square([10,20]);',
    svgRounded: 'linear_extrude(2)import("rounded.svg",$fn=36);',
    svgEllipse: 'linear_extrude(2)import("ellipse.svg",$fn=41);',
    svgLayer: 'linear_extrude(2)import("layers.svg",layer="Part",id="outer");',
    dxfCircle: 'linear_extrude(2)import("circle.dxf",layer="Part",origin=[2,3],scale=2,$fn=24);',
    surfacePng: 'surface("height.png",center=true,invert=true);',
    surfaceData: 'surface("height.dat",center=true);',
    meshImportStl: 'import("part.stl",center=true);',
    meshImportOff: 'import("part.off",center=true);',
    meshImportObj: 'import("part.obj",center=true);',
    meshImport3mf: 'import("part.3mf",center=true);',
    difference: 'difference(){cube(20,center=true);cylinder(h=30,r=5,center=true,$fn=32);}',
    sphere: 'sphere(r=10,$fn=32);',
    octa: 'sphere(r=10,$fn=32,style="octa");',
    revolve: 'rotate_extrude(angle=-135,start=40,$fn=48) translate([-12,0]) square([2,3]);',
    lowSphere: 'sphere(r=3,$fn=3);',
    cone: 'cylinder(h=10,r1=5,r2=0,$fn=7);',
    holes: 'linear_extrude(2) difference(){square(20);translate([3,3]) square(4);}',
    twist: 'linear_extrude(height=10,twist=90,slices=8) translate([10,0]) square([2,3]);',
    directed: 'linear_extrude(height=10,v=[1,0,1],center=true) square([2,3]);',
    projection: 'linear_extrude(2) projection() rotate([20,30,0]) cube(10);',
    resize: 'resize([30,0,0],auto=true) cube([10,20,30]);',
    minkowski: 'minkowski(){cube(10);cube(2);}',
    hull: 'hull(){cube(3);translate([5,4,6])sphere(2,$fn=12);}',
    nonconvexMinkowski: 'minkowski(){difference(){cube(10);translate([3,3,-1])cube([8,8,12]);}cube(2);}',
    offset: 'linear_extrude(2)offset(r=2,$fn=24)difference(){square(20);translate([4,4])square(5);}',
    renderBarrier: 'difference(){render()difference(){cube(20);translate([4,4,-1])cube([4,4,30]);}translate([10,10,-1])cube([4,4,30]);}',
    modifiers: 'union(){#cube(10);%translate([40,0,0])cube(10);*sphere(5);}',
    colors: 'color([.2,.4,.8])color([1,0,0])cube(10);',
    feather: 'sphere(r=10,$fe=.05);',
    svgNoViewBox: 'linear_extrude(2) import("plain.svg");',
    svgViewBox: 'linear_extrude(2) import("viewbox.svg");',
    svgStroke: 'linear_extrude(2) import("stroke.svg",$fn=24);',
    nefImport: 'import("solid.nef3");',
    ligatureText: 'linear_extrude(2)text("office Àéö",font="Liberation Sans",size=10,halign="center",valign="center",spacing=1.2);',
    boldText: 'linear_extrude(2)text("Host",font="Liberation Sans:style=Bold Italic",size=10,halign="right",valign="top");',
    rtlText: 'linear_extrude(2)text("שלום",font="Liberation Sans",size=10,direction="rtl",script="hebr");',
    roof: 'roof(method="straight") square([10,20]);',
    verticalText: 'linear_extrude(2) text("Hello",size=10,font="Liberation Sans",direction="ttb",halign="left",valign="center");',
    text: 'linear_extrude(2) text("Hello",size=10,font="Liberation Sans");',
}
for (const [name, source] of Object.entries(cases))
    test(`native geometry parity: ${name}`, { skip: !executable }, async (t) => {
        const directory = mkdtempSync(join(tmpdir(), 'scad-native-'))
        try {
            writeFileSync(join(directory, 'plain.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M0 0L96 0L96 96L0 96Z"/></svg>')
            writeFileSync(join(directory, 'viewbox.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 100 100"><rect x="10" y="20" width="30" height="40"/></svg>')
            writeFileSync(join(directory, 'stroke.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><path fill="none" stroke="black" stroke-width="2" d="M 2 2 L 18 2 L 18 18"/></svg>')
            writeFileSync(join(directory, 'rounded.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20"><rect x="3" y="2" width="20" height="15" rx="3" ry="2"/></svg>')
            writeFileSync(join(directory, 'ellipse.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20"><ellipse cx="15" cy="10" rx="8" ry="4"/></svg>')
            writeFileSync(join(directory, 'layers.svg'), '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="30mm" height="20mm" viewBox="0 0 30 20"><g inkscape:groupmode="layer" inkscape:label="Other"><rect width="2" height="2"/></g><g id="outer" inkscape:groupmode="layer" inkscape:label="Part"><path d="M4 4L20 4L20 14L4 14Z"/></g></svg>')
            writeFileSync(join(directory, 'circle.dxf'), '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nPart\n10\n5\n20\n6\n30\n0\n40\n4\n0\nENDSEC\n0\nEOF\n')
            writeFileSync(join(directory, 'height.dat'), '1 2 4\n3 8 5\n2 4 3\n')
            const image = new PNG({ width: 3, height: 3 })
            for (let i = 0; i < 9; i++) image.data.set([i * 25, i * 25, i * 25, 255], i * 4)
            writeFileSync(join(directory, 'height.png'), PNG.sync.write(image))
            if (name.startsWith('meshImport')) {
                const format = { meshImportStl: 'stl', meshImportOff: 'off', meshImportObj: 'obj', meshImport3mf: '3mf' }[name]
                execFileSync(executable, ['--export-format', format, '-o', join(directory, `part.${format}`), '-'], { input: 'cube([10,20,30]);', stdio: ['pipe', 'ignore', 'pipe'] })
            }
            if (name === 'nefImport') execFileSync(executable, ['--export-format', 'nef3', '-o', join(directory, 'solid.nef3'), '-'], { input: 'difference(){cube(20);translate([4,4,-1])cube([8,8,30]);}', stdio: ['pipe', 'ignore', 'pipe'] })
            const run = (format) => {
                const path = join(directory, `model.${format}`)
                execFileSync(executable, ['--export-format', format, '-D', '$preview=true', '-o', path, '-'], { input: source, cwd: directory, stdio: ['pipe', 'ignore', 'pipe'] })
                return readFileSync(path)
            }
            let csg, stl
            try {
                csg = run('csg')
                stl = run('stl')
            } catch (error) {
                const message = error.stderr?.toString() ?? String(error)
                if (/Ignoring unknown module|not enabled/.test(message)) {
                    t.skip(message.trim().slice(0, 200))
                    return
                }
                throw new Error(message.slice(0, 2000))
            }
            const nativeGeometry = new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength))
            const native = stats(nativeGeometry.getAttribute('position').array, 3)
            const compiled = await worker({ source: csg.toString(), cwd: directory }),
                topology = await worker({ topology: compiled })
            assert.equal(topology.meshes.length, 1)
            const mesh = topology.meshes[0],
                p = Buffer.from(mesh.properties, 'base64'),
                i = Buffer.from(mesh.indices, 'base64')
            const actual = stats(new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)), mesh.stride, new Uint32Array(i.buffer.slice(i.byteOffset, i.byteOffset + i.byteLength)))
            if (topology.origin)
                for (let d = 0; d < 3; d++) {
                    actual.min[d] += topology.origin[d]
                    actual.max[d] += topology.origin[d]
                }
            for (let d = 0; d < 3; d++) for (const key of ['min', 'max']) assert.ok(Math.abs(actual[key][d] - native[key][d]) < 1e-3, `${name} ${key}[${d}]: ${actual[key][d]} vs ${native[key][d]}`)
            assert.ok(Math.abs(actual.volume - native.volume) < Math.max(0.01, Math.abs(native.volume) * 1e-4), `${name}: volume ${actual.volume} vs ${native.volume}`)
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
