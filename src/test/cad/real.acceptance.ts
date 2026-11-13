import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CadExecutionService } from '../../platform/openscad/CadExecutionService'

const executable = process.env.SCAD_OPENSCAD_EXECUTABLE

test('real official CLI diagnostics: dirty root, dependency paths, assert, parser, warning and valid CSG', async () => {
    assert.ok(executable, 'ENV_UNAVAILABLE: set SCAD_OPENSCAD_EXECUTABLE to an official OpenSCAD CLI')
    const root = await mkdtemp(join(tmpdir(), 'cad-real-中文 ')),
        path = join(root, 'model.scad'),
        include = join(root, 'part.scad')
    const service = new CadExecutionService()
    try {
        await writeFile(path, 'cube(1);')
        await writeFile(include, 'module part(){cube(2);}')
        const request = { command: { executable, argsPrefix: [] }, path, env: process.env, parameters: { $preview: false }, format: 'csg' as const }
        const good = await service.execute({ ...request, source: 'include <part.scad>\npart();' })
        assert.equal(good.status, 'SUCCEEDED', good.log)
        assert.equal(good.dependenciesComplete, true, good.log)
        assert.ok(good.dependencies.includes(await realpath(include)), JSON.stringify(good.dependencies))
        const assertion = await service.execute({ ...request, source: 'assert(false, "fixture assertion");cube(1);' })
        assert.equal(assertion.status, 'FAILED')
        assert.ok(
            assertion.diagnostics.some((d) => d.code === 'SCAD_CLI_ASSERT_FAILED'),
            assertion.log,
        )
        const parser = await service.execute({ ...request, source: 'cube([1,2,3]);\n@' })
        assert.equal(parser.status, 'FAILED')
        assert.ok(
            parser.diagnostics.some((d) => d.code === 'SCAD_CLI_PARSER_ERROR'),
            parser.log,
        )
        const warning = await service.execute({ ...request, source: 'missing_module();cube(1);' })
        assert.ok(
            warning.diagnostics.some((d) => d.code === 'SCAD_CLI_UNKNOWN_SYMBOL' && d.severity === 'warning'),
            warning.log,
        )
        const missing = await service.execute({ ...request, source: 'include <missing-cad-fixture.scad>\ncube(1);' })
        assert.ok(
            missing.diagnostics.some((d) => d.code === 'SCAD_CLI_DEPENDENCY_MISSING'),
            missing.log,
        )
        console.log(JSON.stringify({ platform: process.platform, executable, valid: good.status, assertExit: assertion.exitCode, parserExit: parser.exitCode, dependencies: good.dependencies, scope: 'real CLI only; not Agent/Host/cross-platform acceptance' }))
    } finally {
        service.dispose()
        await rm(root, { recursive: true, force: true })
    }
})
