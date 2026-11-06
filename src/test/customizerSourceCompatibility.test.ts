import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyzeCustomizerSource } from '../core/customizer/CustomizerSourceAnalyzer'
import { parseLiteral } from '../core/customizer/CustomizerLiteral'
import { splitOutsideStrings } from '../core/customizer/CustomizerAnnotation'

test('compatibility corpus covers every semantic audit axis and identifies native evidence', () => {
    const corpus = JSON.parse(readFileSync('src/test/fixtures/customizer-compatibility.json', 'utf8')) as { referenceOpenSCADCommit: string; cases: Array<{ id: string; source: string; expectedIDEParameters: unknown[]; expectedNativeProjection: unknown[]; nativeBuildCommit: string; verificationStatus: string }> }
    assert.equal(corpus.referenceOpenSCADCommit, 'bcf45a22caa954ca56ca287994cb6dbc368c67b2')
    assert.equal(new Set(corpus.cases.map(c => c.id)).size, corpus.cases.length)
    for (const id of ['scalar', 'max-only', 'stepped', 'spin-step', 'checkbox', 'vector', 'unlisted-default', 'quoted-delimiters', 'description-gap', 'expanded-range', 'off-grid', 'hidden-global', 'superseded', 'expression', 'long-vector', 'brace-comment', 'trailing-prose', 'same-line-brace', 'same-line-assignments', 'nfc', 'hint-hex']) assert.ok(corpus.cases.some(c => c.id === id), id)
    for (const fixture of corpus.cases) {
        assert.ok(fixture.nativeBuildCommit)
        assert.match(fixture.verificationStatus, /native-other-build/)
        assert.ok(Array.isArray(fixture.expectedNativeProjection))
        const analysis = analyzeCustomizerSource(fixture.source)
        assert.equal(analysis.complete, true, fixture.id)
    }
})

test('extracted literal and delimiter modules preserve lexical safety without evaluating source', () => {
    assert.equal(parseLiteral('echo("never execute")'), undefined)
    assert.equal(parseLiteral('1+2'), undefined)
    assert.equal(parseLiteral(String.raw`"\u03a9\U01F600"`), 'Ω😀')
    assert.deepEqual(parseLiteral('[1,2,3,4,]'), [1,2,3,4])
    assert.equal(parseLiteral('[1,2,3,4,5]'), undefined)
    assert.deepEqual(splitOutsideStrings('"a]b,c:d", "escaped\\\"comma,"', ','), ['"a]b,c:d"', '"escaped\\\"comma,"'])
})
