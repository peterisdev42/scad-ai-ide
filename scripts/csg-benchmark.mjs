import { benchmarkGpu } from './csg-gpu-benchmark.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, platform, arch } from 'node:os'

const executable = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE || process.env.SCAD_OPENSCAD_EXECUTABLE
if (!executable) throw new Error('Set SCAD_OPENSCAD_CSG_EXECUTABLE to a working OpenSCAD CLI.')
const directory = mkdtempSync(join(tmpdir(), 'scad-csg-benchmark-'))
const samples = [],
    scenes = []
const cases = { hole: 'difference(){cube(30,center=true);cylinder(h=40,r=5,center=true,$fn=32);}', grid: 'for(x=[0:7],y=[0:7])translate([x*15,y*15,0])difference(){cube(12);cylinder(h=15,r=3,$fn=16);}', twist: 'linear_extrude(30,twist=180,slices=32)translate([12,0])square(4);' }
try {
    for (const [name, source] of Object.entries(cases)) {
        const path = join(directory, 'model.csg'),
            started = performance.now()
        execFileSync(executable, ['--export-format', 'csg', '-D', '$preview=true', '-o', path, '-'], { input: source, stdio: ['pipe', 'ignore', 'pipe'] })
        const cliMs = performance.now() - started,
            expanded = readFileSync(path, 'utf8'),
            worker = new Worker(new URL('../dist/csg-worker.mjs', import.meta.url)),
            workerStarted = performance.now()
        let scene
        try {
            scene = await new Promise((resolve, reject) => {
                worker.once('error', reject)
                worker.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r.scene)))
                worker.postMessage({ source: expanded, cwd: directory })
            })
        } finally {
            await worker.terminate()
        }
        scenes.push({ name, scene })
        samples.push({ name, cliMs, workerMs: performance.now() - workerStarted, ...scene.timings, operands: scene.operands.length, triangles: scene.triangleCount, uniqueTriangles: scene.blas.reduce((n, b) => n + b.triangleCount, 0), bytes: Buffer.byteLength(JSON.stringify(scene)) })
    }
    const version = spawnSync(executable, ['--version'], { encoding: 'utf8' })
    const gpu = process.argv.includes('--gpu') ? await benchmarkGpu(scenes) : undefined
    const result = JSON.stringify({ gpu, platform: platform(), arch: arch(), node: process.version, runtime: (version.stdout + version.stderr).trim(), samples }, null, 2) + '\n'
    const output = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
    if (output) writeFileSync(output, result)
    else process.stdout.write(result)
} finally {
    rmSync(directory, { recursive: true, force: true })
}
