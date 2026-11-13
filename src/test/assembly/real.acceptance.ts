import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { CadExecutionService } from '../../platform/openscad/CadExecutionService'
import { assemblyInWorker, configureAssemblyWorker } from '../../platform/cad/AssemblyWorker'
import { evaluate } from '../../core/assembly/constraints'
import { parseManifest } from '../../core/assembly/PartRegistry'
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
test('official selector and project library exports retain the fixed clearance baseline and frozen PNG', async () => {
    const executable = process.env.SCAD_OPENSCAD_EXECUTABLE
    assert.ok(executable, 'ENV_UNAVAILABLE: official OpenSCAD required')
    const root = await mkdtemp(join(tmpdir(), 'assembly-real-中文 ')),
        cli = new CadExecutionService(),
        out = resolve(process.env.SCAD_ASSEMBLY_EVIDENCE ?? '.build/p3-official')
    configureAssemblyWorker(resolve('dist/assembly-verification-worker.mjs'))
    await mkdir(join(root, 'lib/PartLib'), { recursive: true })
    await mkdir(out, { recursive: true })
    const library = 'module body(){difference(){cube([20,20,10]);translate([1,1,1])cube([18,18,10]);}}\nmodule lid(gap){translate([0,0,10+gap])cube([20,20,1]);}\n',
        source = 'include <PartLib/main.scad>\npart="body";gap=0.18;\nif(part=="body")body();else if(part=="lid")lid(gap);\n',
        path = join(root, 'model.scad')
    const manifest = parseManifest(
        JSON.stringify({
            schemaVersion: 1,
            units: 'mm',
            entry: './model.scad',
            parts: ['body', 'lid'].map((id) => ({ id, selector: { type: 'define', name: 'part', value: id } })),
            checks: [
                { id: 'gap', type: 'clearance', parts: ['body', 'lid'], min: 0.25, max: 0.35 },
                { id: 'body-volume', type: 'volume', part: 'body', min: 1083.99, max: 1084.01 },
                { id: 'lid-volume', type: 'volume', part: 'lid', min: 399.99, max: 400.01 },
            ],
        }),
    )
    await writeFile(path, source)
    await writeFile(join(root, 'lib/PartLib/main.scad'), library)
    await writeFile(join(out, 'model.scad'), source)
    await writeFile(join(out, 'library.scad'), library)
    await writeFile(join(out, 'verification.json'), JSON.stringify(manifest.manifest, null, 2))
    const records: unknown[] = []
    try {
        for (const gap of [0.18, 0.3]) {
            const frozen = source.replace('gap=0.18;', `gap=${gap};`),
                parts = []
            for (const id of ['body', 'lid']) {
                const mesh = await cli.execute({
                    command: { executable, argsPrefix: [] },
                    path,
                    source: frozen,
                    parameters: { part: id, $preview: false },
                    env: { ...process.env, OPENSCADPATH: join(root, 'lib') },
                    format: 'stl',
                })
                assert.equal(mesh.status, 'SUCCEEDED', mesh.log)
                assert.equal(mesh.dependenciesComplete, true)
                assert.ok(mesh.dependencies.some((p) => p.endsWith('PartLib/main.scad')))
                parts.push({ id, bytes: mesh.content, format: 'stl' as const, transform: undefined })
                await writeFile(join(out, `${id}-${gap}.stl`), mesh.content)
            }
            const facts = await assemblyInWorker(parts, [['body', 'lid']])
            assert.equal(facts.complete, true, JSON.stringify(facts.incomplete))
            const checks = evaluate(manifest.manifest!, facts)
            assert.equal(checks.find((c) => c.id === 'gap')?.status, gap === 0.18 ? 'FAIL' : 'PASS')
            assert.ok(
                checks.filter((c) => c.id !== 'gap').every((c) => c.status === 'PASS'),
                JSON.stringify(checks),
            )
            const display = join(out, `assembly-${gap}.stl`)
            assert.ok(facts.display)
            await writeFile(display, facts.display.bytes)
            await writeFile(join(out, `assembly-${gap}.asw`), facts.worldMesh!)
            records.push({
                gap,
                manifestDigest: manifest.digest,
                sourceSha256: sha(frozen),
                diskSha256: sha(await readFile(path)),
                meshes: parts.map((p) => ({ id: p.id, sha256: sha(p.bytes) })),
                worldSha256: sha(facts.worldMesh!),
                displaySha256: sha(facts.display.bytes),
                checks,
                pairs: facts.pairs,
            })
            if (gap === 0.3) {
                const png = await cli.execute({
                    command: { executable, argsPrefix: [] },
                    path,
                    source: `import(${JSON.stringify(display)});`,
                    parameters: { $preview: false },
                    env: process.env,
                    format: 'png',
                    image: { camera: [0, 0, 0, 55, 0, 25, 80], projection: 'orthographic', fit: true, size: [512, 512] },
                })
                assert.equal(png.status, 'SUCCEEDED', png.log)
                await writeFile(join(out, 'assembly-iso.png'), png.content)
                records.push({ pngSha256: sha(png.content), sourceMeshSha256: sha(await readFile(display)), width: 512, height: 512 })
            }
        }
        assert.equal(await readFile(path, 'utf8'), source)
        await writeFile(join(out, 'official-cli.json'), JSON.stringify({ executable, records, manifestDigest: manifest.digest, diskUnchanged: true }, null, 2))
    } finally {
        cli.dispose()
        await rm(root, { recursive: true, force: true })
    }
})
