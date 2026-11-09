import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyzeCustomizerSource } from '../core/customizer/CustomizerSourceAnalyzer'
import { ideCompatibilityProjection } from './fixtures/CustomizerCompatibilityProjection'

// A separate strict gate: known defects remain failing until approved and fixed.
// Run: npm run compile-tests && node --test out/test/customizerCompatibility.acceptance.js
const corpus = JSON.parse(readFileSync('src/test/fixtures/customizer-compatibility.json', 'utf8')) as {
    referenceOpenSCADCommit: string
    cases: Array<{ id: string; source: string; expectedIDEParameters: unknown[]; expectedNativeProjection: unknown[]; nativeBuildCommit: string }>
}
for (const fixture of corpus.cases) {
    test(`native compatibility: ${fixture.id}`, () => {
        assert.equal(corpus.referenceOpenSCADCommit, 'bcf45a22caa954ca56ca287994cb6dbc368c67b2')
        assert.equal(fixture.nativeBuildCommit, '9ba0cee7c94785fac0ca8dfe040b965a12a25ed1')
        assert.deepEqual(fixture.expectedIDEParameters, fixture.expectedNativeProjection, 'Target projections must agree; baseline IDE output is not the expected behavior')
        const analysis = analyzeCustomizerSource(fixture.source)
        assert.equal(analysis.complete, true)
        assert.deepEqual(analysis.parameters.map(ideCompatibilityProjection), fixture.expectedIDEParameters)
    })
}
