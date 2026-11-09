import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import assert from 'node:assert/strict'

// Runs explicit native probes. It never downloads a runtime or modifies user models.
const binary = process.argv[2]
assert.ok(binary, 'Supply an explicit native OpenSCAD executable')
const cases = [
    { id: 'bool-import', source: 'enabled=true;\necho(enabled);\n', values: { enabled: '0' }, expectedEcho: 'ECHO: false\n' },
    { id: 'enum-number-first', source: 'mode=1; // [1:Numeric,"1":String]\necho(mode);\n', values: { mode: '1' }, expectedEcho: 'ECHO: 1\n' },
    { id: 'enum-string-first', source: 'mode="1"; // ["1":String,1:Numeric]\necho(mode);\n', values: { mode: '1' }, expectedEcho: 'ECHO: "1"\n' },
    { id: 'text-import', source: 'label="abcdef"; // 3\necho(label);\n', values: { label: '123456' }, expectedEcho: 'ECHO: "123"\n', expectedMaxLength: 3 },
    { id: 'utf8-import', source: 'label="Ω😀"; // 1\necho(label);\n', values: { label: 'Ω😀' }, expectedEcho: 'ECHO: "�"\n', expectedMaxLength: 1 },
    { id: 'offgrid-import', source: 'w=10; // [0:5:100]\nv=[2,4]; // [0:2:10]\necho(w=w,v=v);\n', values: { w: '12', v: '[3,5]' }, expectedEcho: 'ECHO: w = 12, v = [3, 5]\n' },
]
const directory = mkdtempSync(join(tmpdir(), 'customizer-import-parity-'))
const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 })
assert.equal(version.status, 0, version.error?.message || version.stderr)
const report = { binary: resolve(binary), version: (version.stdout + version.stderr).trim(), platform: process.platform, node: process.version, build: undefined, referenceOpenSCADCommit: 'bcf45a22caa954ca56ca287994cb6dbc368c67b2', results: [] }
try { report.build = JSON.parse(readFileSync(resolve(dirname(binary), '../build-info.json'), 'utf8')) } catch { /* Not every runtime has build metadata. */ }
try {
    for (const fixture of cases) {
        const base = join(directory, fixture.id)
        writeFileSync(base + '.scad', fixture.source)
        writeFileSync(base + '.json', JSON.stringify({ fileFormatVersion: '99', parameterSets: { Test: fixture.values } }))
        const options = { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
        execFileSync(binary, ['-o', base + '.param', base + '.scad'], options)
        execFileSync(binary, ['-p', base + '.json', '-P', 'Test', '-o', base + '.echo', base + '.scad'], options)
        const schema = JSON.parse(readFileSync(base + '.param', 'utf8'))
        const echo = readFileSync(base + '.echo')
        assert.equal(echo.toString('utf8'), fixture.expectedEcho, fixture.id)
        if (fixture.expectedMaxLength !== undefined) assert.equal(schema.parameters[0].maxLength, fixture.expectedMaxLength, fixture.id)
        report.results.push({ ...fixture, schema, echo: echo.toString('utf8'), echoHex: echo.toString('hex'), status: 'native-verified-other-build' })
    }
} finally { rmSync(directory, { recursive: true, force: true }) }
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n')
console.log(`PASS ${report.results.length} native schema/import probes; unknown version 99 was read, not evidence that arbitrary future versions can be overwritten.`)
