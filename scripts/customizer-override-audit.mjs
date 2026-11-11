import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import assert from 'node:assert/strict'

// Native .param differential only. N-12's live UI cleanup is a separate Host test.
const require = createRequire(import.meta.url)
const { analyzeCustomizerSource } = require('../out/core/customizer/CustomizerSourceAnalyzer.js')
const { nativeCompatibilityProjection, ideCompatibilityProjection } = require('../out/test/fixtures/CustomizerCompatibilityProjection.js')
const binary = process.argv[2]
assert.ok(binary, 'Supply an explicit OpenSCAD binary')
const cases = [
    { id: 'N-01', source: 'width=40;\n', warnings: 0 },
    { id: 'N-02', source: 'width=40;\nmodule m(){}\nwidth=50;\n', warnings: 1 },
    // The entire brace line is outside the native Customizer region, so its
    // first assignment never offered a control to lose.
    { id: 'N-02-same-line', source: 'width=40; module m(){} width=50;\n', warnings: 0 },
    { id: 'N-03', source: 'base=80;\nwidth=40;\nmodule m(){}\nwidth=base/2;\n', warnings: 1 },
    { id: 'N-04', source: 'width=40;\nwidth=50;\nmodule m(){}\n', warnings: 0 },
    { id: 'N-05', source: 'width=40;\nmodule m(){width=50;}\n', warnings: 0 },
    { id: 'N-06', source: '/* [Hidden] */\nwidth=40;\nmodule m(){}\nwidth=50;\n', warnings: 0 },
    { id: 'N-07-comment', source: '// { not a code block\nwidth=40;\n', warnings: 0 },
    { id: 'N-07-string', source: 'label="{";\nwidth=40;\n', warnings: 0 },
    { id: 'N-08', source: 'include <brace{fixture.scad>\nwidth=40;\n', files: { 'brace{fixture.scad': '// empty dependency\n' }, warnings: 0 },
    { id: 'N-09', source: '\uFEFFépaisseur=40;\r\nmodule m(){}\r\népaisseur=50;\r\n', warnings: 1 },
    { id: 'N-10', source: 'width=40;\nheight=20;\nmodule m(){}\nwidth=50;\n', warnings: 1 },
    { id: 'N-11', source: 'width=40;\nheight=20;\nmodule m(){}\nwidth=50;\nheight=60;\n', warnings: 2 },
    { id: 'N-12', source: 'width=40;\nheight=20;\nmodule m(){}\n', warnings: 0 },
]
const run = args => {
    const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
    return { exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }
}
const referenceCommit = 'bcf45a22caa954ca56ca287994cb6dbc368c67b2'
const binarySha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')
let build
try { build = JSON.parse(readFileSync(path.resolve(path.dirname(binary), '../build-info.json'), 'utf8')) } catch { /* Unknown provenance stays unknown. */ }
const report = { sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), referenceCommit, binary: path.resolve(binary), binarySha256, build, pinnedBinary: build?.commit === referenceCommit && build?.sha256 === binarySha256, platform: process.platform, node: process.version, version: run(['--version']), scope: 'Native CLI .param; not Qt GUI. N-12 is the edited snapshot, not live UI cleanup.', results: [] }
const feature = run(['--enable=unicode-identifiers', '--version'])
const options = feature.exitCode === 0 ? ['--enable=unicode-identifiers'] : []
report.nativeOptions = options
const directory = mkdtempSync(path.join(tmpdir(), 'customizer-override-'))
try {
    for (const fixture of cases) {
        const folder = path.join(directory, fixture.id)
        mkdirSync(folder)
        for (const [name, content] of Object.entries(fixture.files ?? {})) writeFileSync(path.join(folder, name), content)
        const source = path.join(folder, 'main.scad'), output = path.join(folder, 'main.param')
        writeFileSync(source, fixture.source)
        const native = run([...options, '-o', output, source])
        let rawParam = null, parseError = null
        try { rawParam = readFileSync(output, 'utf8') } catch (error) { parseError = error.message }
        let actualNative = null
        try {
            const parsed = JSON.parse(rawParam)
            assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            actualNative = parsed.parameters ?? [] // Native omits the key for no controls.
            assert.ok(Array.isArray(actualNative))
        } catch (error) { parseError = error.message }
        const ide = analyzeCustomizerSource(fixture.source)
        const warnings = ide.diagnostics.filter(d => d.ruleId === 'CUST-VIS-01')
        const names = actualNative?.map(p => p.name)
        const nativeProjection = actualNative?.map(nativeCompatibilityProjection)
        const ideProjection = ide.parameters.map(ideCompatibilityProjection)
        const parity = isDeepStrictEqual(nativeProjection, ideProjection)
        const warningMatches = warnings.length === fixture.warnings && warnings.every(d => d.severity === 'warning' && d.relatedInformation?.length && d.fix.safety === 'review')
        const passed = native.exitCode === 0 && !parseError && parity && warningMatches
        report.results.push({ ...fixture, native, rawParam, parseError, actualNative, actualIDE: ide.parameters, nativeProjection, ideProjection, diagnostics: ide.diagnostics, parity, warningMatches, status: passed ? 'PASS' : 'FAIL' })
        console.log(`${passed ? 'PASS' : 'FAIL'} ${fixture.id}: native=${JSON.stringify(names)} IDE=${JSON.stringify(ide.parameters.map(p => p.name))} warnings=${warnings.length}/${fixture.warnings}`)
    }
} finally { rmSync(directory, { recursive: true, force: true }) }
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n')
if (report.results.some(r => r.status !== 'PASS') || report.version.exitCode !== 0) process.exitCode = 1
