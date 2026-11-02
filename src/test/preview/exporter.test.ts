import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertExporterPlatform, discoverExporters, EXPORTER_SHA256, installExporter, managedExporterPath, probeExporter, runExporter } from '../../platform/previewExporter/runtime'
import { fileCandidate, probe } from '../../platform/runtime/discovery'
import type { PreviewScene } from '../../core/preview/types'
import { readPreviewScene } from '../../core/preview/read'
const executable = process.env.SCAD_PREVIEW_EXPORTER
// Pure tests run on every platform; real executable tests require the explicit integration command.
test('unsupported platforms reject Fast Preview and identify Full Render', () => {
    assert.throws(() => assertExporterPlatform('linux', 'arm64'), /Full Render/)
    assert.throws(() => assertExporterPlatform('darwin', 'x64'), /Full Render/)
})
test('normal CLI cannot masquerade as Preview Exporter', async () => {
    if (process.platform === 'darwin' && process.arch === 'arm64') await assert.rejects(probeExporter('/usr/bin/openscad'), /independent/)
})
test('download rejects a changed published checksum before archive extraction', async () => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return
    const root = await mkdtemp(join(tmpdir(), 'exporter-download-test-'))
    try {
        let requests = 0
        await assert.rejects(
            installExporter(root, undefined, async () => {
                requests++
                return new Response('0'.repeat(64) + '  exporter.tar.gz')
            }),
            /SHA256 mismatch/,
        )
        assert.equal(requests, 1)
        await assert.rejects(access(managedExporterPath(root)))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
test('download verifies archive contents against pinned SHA256', async () => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return
    const root = await mkdtemp(join(tmpdir(), 'exporter-corrupt-test-'))
    try {
        let requests = 0
        await assert.rejects(
            installExporter(root, undefined, async () => new Response(++requests === 1 ? EXPORTER_SHA256 + '  exporter.tar.gz' : 'corrupt archive')),
            /verification failed/,
        )
        assert.equal(requests, 2)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
if (executable) {
    test('real exporter discovery, dirty stdin, Customizer overrides, $preview and dependencies', async () => {
        const root = await mkdtemp(join(tmpdir(), 'exporter-integration-'))
        try {
            assert.equal((await probeExporter(executable)).schemaVersion, 1)
            assert.equal((await discoverExporters(root, executable))[0].executable, executable)
            const sourcePath = join(root, 'model.scad')
            await writeFile(sourcePath, 'cube(999);')
            await writeFile(join(root, 'part.scad'), 'module part(){cube(width,center=true);}')
            const buffer = await runExporter(executable, 'use <part.scad>\nwidth=2; if($preview)part();', root, { width: 12 }, undefined, sourcePath),
                scene = JSON.parse(buffer.toString()) as PreviewScene
            assert.equal(scene.bounds.max[0] - scene.bounds.min[0], 12)
            assert.ok(scene.dependencies.some((d) => d.path.endsWith('part.scad')))
            assert.ok(!scene.dependencies.some((d) => d.path === sourcePath), 'source document changes use document watcher; dependency watcher excludes source')
            await writeFile(join(root, 'part.scad'), 'module part(){sphere(width,$fn=12);}')
            const next = JSON.parse((await runExporter(executable, 'use <part.scad>\npart();', root, { width: 5 }, undefined, sourcePath)).toString()) as PreviewScene
            assert.notDeepEqual(next.geometryKeys, scene.geometryKeys)
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
    test('real exporter cancellation interrupts execution and never publishes a result', async () => {
        const controller = new AbortController()
        controller.abort()
        await assert.rejects(runExporter(executable, 'sphere(10);', tmpdir(), {}, controller.signal), /abort/i)
        const next = new AbortController(),
            pending = runExporter(executable, 'minkowski(){sphere(20,$fn=100);sphere(10,$fn=100);}', tmpdir(), {}, next.signal)
        setTimeout(() => next.abort(), 15)
        await assert.rejects(pending, /abort|failed/i)
    })
}

if (executable && process.env.SCAD_PREVIEW_EXPORTER_ARCHIVE)
    test('verified native archive installs separately, rediscovers, and repairs an invalid managed package', async () => {
        const root = await mkdtemp(join(tmpdir(), 'exporter-install-test-'))
        try {
            const bytes = await readFile(process.env.SCAD_PREVIEW_EXPORTER_ARCHIVE!),
                request: typeof fetch = async (url) => (String(url).endsWith('.sha256') ? new Response(EXPORTER_SHA256 + '  exporter.tar.gz') : new Response(bytes))
            const installed = await installExporter(root, undefined, request)
            assert.equal(installed.executable, managedExporterPath(root))
            assert.equal((await discoverExporters(root))[0].executable, installed.executable)
            await assert.rejects(probe(fileCandidate(installed.executable, 'custom')), /separate capability/)
            await assert.rejects(probe(fileCandidate(join(root, 'preview-exporter', 'openscad-2026.11-RC0', 'OpenSCAD.app/Contents/MacOS/OpenSCAD'), 'custom')), /ordinary OpenSCAD/)
            await writeFile(join(root, 'preview-exporter', 'openscad-2026.11-RC0', 'build-info.json'), '{}')
            assert.equal((await installExporter(root, undefined, request)).commit, '9ba0cee7c94785fac0ca8dfe040b965a12a25ed1')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

if (executable)
    test('native include/use/import resolve cwd and OPENSCADPATH and expose dependency changes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'exporter-import-test-')),
            previous = process.env.OPENSCADPATH
        try {
            const { mkdir } = await import('node:fs/promises')
            const work = join(root, 'work'),
                lib = join(root, 'lib')
            await mkdir(work)
            await mkdir(lib)
            await writeFile(join(lib, 'settings.scad'), 'width=4;')
            await writeFile(join(lib, 'helper.scad'), 'module helper(){translate([30,0,0])cube(width);}')
            const topology = JSON.parse(await readFile(new URL('./fixtures/prepared/cube.topology.json', import.meta.url), 'utf8')),
                buffer = Buffer.from(topology.meshes[0].properties, 'base64'),
                vertices = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
            let stl = 'solid dependency\n'
            for (let i = 0; i < vertices.length; i += 9) stl += `facet normal 0 0 0\nouter loop\n${[0, 3, 6].map((k) => `vertex ${Array.from(vertices.subarray(i + k, i + k + 3)).join(' ')}`).join('\n')}\nendloop\nendfacet\n`
            stl += 'endsolid dependency\n'
            const imported = join(work, 'part.stl')
            await writeFile(imported, stl)
            process.env.OPENSCADPATH = lib
            const source = 'include <settings.scad>\nuse <helper.scad>\nimport("part.stl");helper();'
            const first = JSON.parse((await runExporter(executable, source, work)).toString()) as PreviewScene
            for (const name of ['settings.scad', 'helper.scad', 'part.stl'])
                assert.ok(
                    first.dependencies.some((d) => d.path.endsWith(name)),
                    name,
                )
            await writeFile(imported, stl + '\n')
            const second = JSON.parse((await runExporter(executable, source, work)).toString()) as PreviewScene
            assert.notEqual(first.dependencies.find((d) => d.path.endsWith('part.stl'))?.stamp, second.dependencies.find((d) => d.path.endsWith('part.stl'))?.stamp)
            await assert.rejects(runExporter(executable, 'cube(;', work), /Parser error|syntax error/)
        } finally {
            if (previous === undefined) delete process.env.OPENSCADPATH
            else process.env.OPENSCADPATH = previous
            await rm(root, { recursive: true, force: true })
        }
    })

if (executable) {
    test('production quick preview returns prepared Products without final-mesh materialization', async () => {
        const profiles: Record<string, number> = {}
        const result = JSON.parse((await runExporter(executable, 'color([0.2,0.4,0.8,0.7])difference(){cube(20,center=true);cylinder(r=4,h=30,center=true,$fn=16);} #translate([30,0,0])cube(4); %translate([-30,0,0])sphere(5,$fn=12);', tmpdir(), {}, undefined, undefined, undefined, (value) => Object.assign(profiles, value))).toString()) as PreviewScene
        assert.equal(result.version, 'preview-scene-1')
        assert.ok(result.products.some((p) => p.subtractions.length))
        assert.ok(result.highlights.length && result.backgrounds.length)
        assert.equal('layers' in result, false)
        for (const key of ['runtimeMs', 'exporterMs', 'readMs', 'jsonParseMs', 'validationMs', 'conversionMs', 'dependenciesMs', 'serializationMs', 'cleanupMs']) assert.ok(Number.isFinite(profiles[key]) && profiles[key] >= 0, key)
    })
}
