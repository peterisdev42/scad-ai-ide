import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { CadExecutionService } from '../../platform/openscad/CadExecutionService'
import { analyzeInWorker, configureMeshVerificationWorker } from '../../platform/cad/MeshWorker'
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
test('official Full Render and frozen STL PNG retain geometry, requested quality and input hash', async () => {
    const executable = process.env.SCAD_OPENSCAD_EXECUTABLE
    assert.ok(executable, 'ENV_UNAVAILABLE: official CLI required')
    configureMeshVerificationWorker(resolve('dist/mesh-verification-worker.mjs'))
    const root = await mkdtemp(join(tmpdir(), 'p2-real-中文 ')),
        path = join(root, 'model.scad'),
        cli = new CadExecutionService(),
        records: unknown[] = []
    await writeFile(path, 'cube(1);')
    try {
        const artifactDirectory = process.env.SCAD_MESH_EVIDENCE
        if (artifactDirectory) await mkdir(artifactDirectory, { recursive: true })
        const request = { command: { executable, argsPrefix: [] }, path, env: process.env, parameters: { $preview: false }, format: 'stl' as const }
        for (const [name, source, expected] of [
            ['box', 'cube([2,3,4]);', 24],
            ['cavity', 'difference(){cube(3);translate([1,1,1])cube(1);}', 26],
        ] as const) {
            const mesh = await cli.execute({ ...request, source })
            assert.equal(mesh.status, 'SUCCEEDED', mesh.log)
            const audit = await analyzeInWorker(mesh.content, 'stl')
            assert.equal(audit.facts?.physicalVolume.value, expected, JSON.stringify(audit))
            const file = join(root, name + '.stl')
            await writeFile(file, mesh.content)
            if (artifactDirectory) await writeFile(join(artifactDirectory, name + '.stl'), mesh.content)
            records.push({ name, sha256: sha(mesh.content), triangles: audit.facts.rawTriangles, physicalVolume: audit.facts.physicalVolume })
            if (name === 'box') {
                const frozenHash = sha(mesh.content)
                const image = await cli.execute({ ...request, source: `import(${JSON.stringify(file)});`, format: 'png', image: { camera: [0, 0, 0, 55, 0, 25, 15], projection: 'orthographic', fit: true, size: [512, 512] } })
                assert.equal(image.status, 'SUCCEEDED', image.log)
                if (artifactDirectory) await writeFile(join(artifactDirectory, 'frozen-box-iso.png'), image.content)
                const png = PNG.sync.read(image.content)
                assert.equal(png.width, 512)
                assert.equal(png.height, 512)
                assert.equal(sha(await readFile(file)), frozenHash)
                records.push({ name: 'frozen-png', sourceMeshSha256: frozenHash, pngSha256: sha(image.content), width: png.width, height: png.height })
            }
        }
        const csg = await cli.execute({ ...request, format: 'csg', source: 'cube([2,3,4]);' })
        assert.equal(csg.status, 'SUCCEEDED', csg.log)
        const csgPath = join(root, 'compiled.csg')
        await writeFile(csgPath, csg.content)
        const fromCsg = await cli.execute({ ...request, path: csgPath, source: Buffer.from(csg.content).toString('utf8') })
        assert.equal(fromCsg.status, 'SUCCEEDED', fromCsg.log)
        assert.equal((await analyzeInWorker(fromCsg.content, 'stl')).facts?.physicalVolume.value, 24)
        records.push({ name: 'csg-input', sourceSha256: sha(csg.content), meshSha256: sha(fromCsg.content), physicalVolume: 24 })
        if (artifactDirectory) {
            await writeFile(join(artifactDirectory, 'compiled.csg'), csg.content)
            await writeFile(join(artifactDirectory, 'compiled-csg.stl'), fromCsg.content)
        }
        const triangles = []
        for (const fn of [12, 48]) {
            const mesh = await cli.execute({ ...request, source: 'cylinder(h=2,r=1);', parameters: { $preview: false, $fn: fn } })
            assert.equal(mesh.status, 'SUCCEEDED', mesh.log)
            const audit = await analyzeInWorker(mesh.content, 'stl')
            assert.equal(audit.facts?.physicalVolume.status, 'PASS', JSON.stringify(audit.facts?.findings))
            triangles.push(audit.facts.rawTriangles)
            records.push({ name: 'cylinder', fn, meshSha256: sha(mesh.content), triangles: audit.facts.rawTriangles, volume: audit.facts.physicalVolume })
        }
        assert.ok(triangles[1] > triangles[0])
        const empty = await cli.execute({ ...request, source: 'difference(){cube(1);cube(1);}' })
        assert.equal(empty.empty, true, empty.log)
        const destination = process.env.SCAD_MESH_EVIDENCE
        if (destination) {
            await mkdir(destination, { recursive: true })
            await writeFile(join(destination, 'official-cli.json'), JSON.stringify({ scope: 'Real official CLI and raw Worker; not Host/Agent/cross-platform', platform: process.platform, executable, records, empty: { status: empty.status, empty: empty.empty } }, null, 2))
        }
        console.log(JSON.stringify({ scope: 'official CLI + Worker', platform: process.platform, records, empty: true }))
    } finally {
        cli.dispose()
        await rm(root, { recursive: true, force: true })
    }
})
