import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, sep } from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'

// Read-only differential audit: mismatches are evidence, never silently rewritten expectations.
const require = createRequire(import.meta.url)
const { analyzeCustomizerSource } = require('../out/core/customizer/CustomizerSourceAnalyzer.js')
const { nativeCompatibilityProjection, ideCompatibilityProjection } = require('../out/test/fixtures/CustomizerCompatibilityProjection.js')
const binary = process.argv[2] || process.env.SCAD_CUSTOMIZER_NATIVE
if (!binary) throw new Error('Supply an explicit OpenSCAD executable; this audit never downloads a runtime.')
const fixtures = JSON.parse(readFileSync(new URL('../src/test/fixtures/customizer-compatibility.json', import.meta.url), 'utf8'))
const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 })
if (version.status !== 0) throw new Error(version.error?.message || version.stderr)
let build
try { build = JSON.parse(readFileSync(resolve(dirname(binary), '../build-info.json'), 'utf8')) } catch { /* Arbitrary installations may not expose build metadata. */ }
const directory = mkdtempSync(join(tmpdir(), 'scad-customizer-parity-'))
// GUI builds can gate NFC identifiers behind an experimental switch; some
// managed builds accept them without exposing that switch. Probe option support
// without source execution, then record the exact corpus invocation profile.
const featureProbe = spawnSync(binary, ['--enable=unicode-identifiers', '--version'], { encoding: 'utf8', timeout: 15000 })
const featureProbeOutput = (featureProbe.stdout ?? '') + (featureProbe.stderr ?? '')
if (featureProbe.status !== 0 && !/unrecogni[sz]ed option.*--enable/.test(featureProbeOutput)) throw new Error(featureProbe.error?.message || featureProbeOutput)
const nativeOptions = featureProbe.status === 0 ? ['--enable=unicode-identifiers'] : []
const report = { referenceOpenSCADCommit: fixtures.referenceOpenSCADCommit, nativeOptions, unicodeFeatureSwitchSupported: featureProbe.status === 0, binary: resolve(binary), version: (version.stdout + version.stderr).trim(), buildCommit: build?.commit ?? null, pinnedBinary: build?.commit === fixtures.referenceOpenSCADCommit, platform: process.platform, node: process.version, results: [] }
try {
    for (const fixture of fixtures.cases) {
        const file = join(directory, fixture.id + '.scad'), output = join(directory, fixture.id + '.param')
        for (const [relative, content] of Object.entries(fixture.files ?? {})) {
            const target = resolve(directory, relative)
            if (!target.startsWith(directory + sep)) throw new Error('Fixture resource is outside its temporary directory')
            mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content)
        }
        writeFileSync(file, fixture.source)
        const native = spawnSync(binary, [...nativeOptions, '-o', output, file], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
        if (native.status !== 0) throw new Error(`${fixture.id}: ${native.error?.message || native.stderr}`)
        const actualNative = JSON.parse(readFileSync(output, 'utf8')).parameters ?? []
        const ide = analyzeCustomizerSource(fixture.source)
        const nativeProjection = actualNative.map(nativeCompatibilityProjection)
        const ideProjection = ide.parameters.map(ideCompatibilityProjection)
        const nativeExpectationMatches = isDeepStrictEqual(nativeProjection, fixture.expectedNativeProjection)
        report.results.push({ id: fixture.id, source: fixture.source, expectedNativeParameters: fixture.expectedNativeParameters, expectedIDEParameters: fixture.expectedIDEParameters, nativeExpectationMatches, actualNative, actualIDE: ide.parameters, diagnostics: ide.diagnostics, nativeProjection, ideProjection, parity: isDeepStrictEqual(nativeProjection, ideProjection), verificationStatus: report.pinnedBinary ? 'native-pinned' : 'native-other-build' })
    }
} finally { rmSync(directory, { recursive: true, force: true }) }
const output = process.argv[3]
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(`${report.version} (${report.buildCommit ?? 'unknown commit'}); pinned=${report.pinnedBinary}`)
for (const row of report.results) console.log(`${row.parity ? 'MATCH' : 'DIFF'} ${row.id}`)
console.log(`${report.results.filter(r => r.parity).length}/${report.results.length} matching projections; this audit is not an assertion that all native behavior is compatible.`)

const nativeDrift = report.results.filter(result => !result.nativeExpectationMatches)
if (nativeDrift.length) {
    console.error(`Native fixture drift: ${nativeDrift.map(result => result.id).join(', ')}`)
    process.exitCode = 1
}
if (process.argv.includes('--strict') && report.results.some(result => !result.parity)) process.exitCode = 1
