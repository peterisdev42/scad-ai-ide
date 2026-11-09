import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseCustomizer, scanCustomizer } from '../core/customizer/CustomizerParser'
import { analyzeCustomizerSource } from '../core/customizer/CustomizerSourceAnalyzer'

const codes = (source: string) => analyzeCustomizerSource(source).diagnostics.map((d) => d.code)
test('source analyzer retains existing GUI fixtures and all supported widgets', () => {
    const source = readFileSync('examples/customizer.scad', 'utf8')
    const analysis = analyzeCustomizerSource(source)
    assert.deepEqual(analysis.parameters.map(({ widget: _w, declarationRange: _d, annotationRange: _a, descriptionRange: _r, ...p }) => p), parseCustomizer(source))
    const widgets = analyzeCustomizerSource('a=5; // [10]\nb=2.5; // .5\nc=true;\nd="Hi"; // 20\ne=[1,2]; // [0:1:10]\nf="x"; // [x:X,y:Y]').parameters.map((p) => p.widget)
    assert.deepEqual(widgets, ['slider', 'spinbox', 'checkbox', 'textbox', 'vector', 'dropdown'])
})
test('shared scanner tracks exact UTF-16 declaration/comment spans, Unicode, strings and CRLF', () => {
    const source = '// 😀 description\r\n宽度 = 0x10; // [0:8:32]\r\ntext="{;//";\r\nvector=[1,\r\n2,3,];\r\n'
    const analysis = analyzeCustomizerSource(source)
    assert.equal(analysis.complete, true)
    assert.equal(analysis.parameters.length, 3)
    assert.deepEqual(analysis.parameters[0].declarationRange, { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } })
    assert.deepEqual(analysis.parameters[0].descriptionRange, { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } })
    assert.equal(analysis.parameters[1].defaultValue, '{;//')
    for (const d of scanCustomizer(source).declarations) assert.match(source.slice(d.start, d.end), new RegExp('^' + d.name + '\\s*='))
})
test('groups, Hidden, post-brace variables and duplicates retain legacy visibility', () => {
    const source = '/* [Global] */\na=1;\n/* [Hidden] */\nb=2;\n/* [Dimensions] */\nc=3; // [0:10]\nc=4;\nmodule x() {}\nd=5; // [0:10]'
    const result = analyzeCustomizerSource(source)
    assert.deepEqual(result.parameters.map((p) => [p.name, p.group]), [['a', 'Global'], ['c', 'Dimensions']])
    assert.ok(result.candidates.some((c) => c.name === 'b' && c.reason === 'hidden'))
    assert.ok(result.candidates.some((c) => c.name === 'd' && c.reason === 'afterFirstBrace'))
    assert.equal(result.diagnostics.some((d) => d.code === 'CUSTOMIZER_DUPLICATE_ASSIGNMENT'), false)
})
test('ordinary variables, prose and expressions without intent produce no warnings', () => {
    assert.deepEqual(codes('// computed\na=width/10;\nb=3; // width between 10 and 100\nb2=3; // 3 inches recommended\nc=[1,2,3,4,5];\ns="//[bad]";'), [])
    assert.deepEqual(codes('a=width/10; // [0:10]'), [])
})
test('deterministic invalid ranges, steps, defaults, choices and malformed hints', () => {
    for (const [source, code] of [
        ['a=10; // [10:0:100]', 'INVALID_RANGE'], ['a=10; // [100:10]', 'INVALID_RANGE'],
        ['a=101; // [0:100]', 'DEFAULT_OUT_OF_RANGE'],
        ['a=1; // [0:10', 'MALFORMED_HINT'], ['a=1; // 0', 'MALFORMED_HINT'],
        ['a=1; // [1,,2]', 'INVALID_CHOICES'],
    ]) assert.ok(codes(source).includes('CUSTOMIZER_' + code), source)
    assert.deepEqual(codes('a="a,b"; // ["a,b":"A:B", "c":"C"]'), [])
    assert.equal(analyzeCustomizerSource('a=1e2; // [0:50:200]').parameters[0].defaultValue, 100)
})
test('incomplete and bounded analyses never claim completeness', () => {
    for (const source of ['a="unterminated', 'a=[1,2;', '/* missing', 'module m() {']) assert.equal(analyzeCustomizerSource(source).complete, false, source)
    assert.equal(analyzeCustomizerSource('x'.repeat(1024 * 1024 + 1)).complete, false)
    const limited = analyzeCustomizerSource('a=1; // [10:0:100]', { maxDiagnostics: 0 })
    assert.equal(limited.complete, false)
    assert.equal(limited.omitted.diagnostics, 1)
    assert.equal(analyzeCustomizerSource('a=width/10;', { includeCandidates: false }).candidates.length, 0)
})
test('100 KiB source analysis benchmark reports p95 and remains below 100 ms locally', () => {
    const source = 'width=40; // [10:5:100]\n' + '// Ordinary geometry comment, no parameter intent.\n'.repeat(2100)
    const samples = Array.from({ length: 25 }, () => { const start = performance.now(); analyzeCustomizerSource(source); return performance.now() - start }).sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * .95)]
    console.log(`Customizer analyzer ${Buffer.byteLength(source)} bytes p95=${p95.toFixed(2)}ms; ${process.platform}/${process.arch} Node ${process.version}`)
    assert.ok(p95 < 100, `p95 ${p95}ms`)
})


test('oversized metadata is omitted rather than fabricated or leaked as an unbounded result', () => {
    const source = 'label="' + 'x'.repeat(20000) + '";'
    const result = analyzeCustomizerSource(source)
    assert.equal(result.complete, false)
    assert.equal(result.parameters.length, 0)
    assert.equal(result.omitted.parameters, 1)
    assert.ok(JSON.stringify(result).length < 1000)
})


test('legal range hints and effective literal reassignments do not produce duplicate warnings', () => {
    const source = 'width=10; // [1:1:200]\nheight=20; // [1:1:200]\nwidth=30; // [1:1:200]\nheight=40; // [1:1:200]\n'
    const analysis = analyzeCustomizerSource(source)
    assert.deepEqual(analysis.diagnostics, [])
    assert.deepEqual(analysis.parameters.map((p) => [p.name, p.defaultValue, p.widget]), [['width', 30, 'slider'], ['height', 40, 'slider']])
    assert.deepEqual(codes('width=10; // [1:1:200]\nmodule model() { width=20; height=30; }'), [])
    assert.deepEqual(codes('width=10; // [1:1:200]\n/* [Hidden] */\nwidth=20;'), [])
    assert.deepEqual(codes('width=10; // [1:1:200]\nmodule model() {}\nwidth=20;'), [])
})

test('superseded invalid hints/defaults stop reporting once the effective declaration is corrected', () => {
    const obsolete = 'width=0; // [1:0:200]\n'
    assert.ok(codes(obsolete).includes('CUSTOMIZER_INVALID_RANGE'))
    assert.deepEqual(codes(obsolete + 'width=30; // [1:1:200]\n'), [])
    assert.deepEqual(codes('width=201; // [1:1:200]\nwidth=30; // [1:1:200]\n'), [])
    assert.deepEqual(codes('shape="missing"; // [round,square]\nshape="round"; // [round,square]\n'), [])
})

test('ordinary SCAD and optional or unsupported Customizer usage never generate diagnostics', () => {
    for (const source of [
        'width=10; // [1:1:200]\nwidth=10+20;',
        'width=10+20; // [1:1:200]',
        'width=30; height=40; derived=width/2;',
        'quality=2; // [0:5:100]',
        'shape="round"; // [square,circle]',
        'quality=1; // [one,two]',
        'quality=1; // [1:One,1:Also One,2:Two]',
        'flag=true; // [0:1]',
        'vector=[1,2,3,4,5]; // [0:100]',
        'internal=2;\n/* [Hidden] */\ninternal=width/2;',
        'width=40; // [TODO check the width later',
    ]) assert.deepEqual(analyzeCustomizerSource(source).diagnostics, [], source)
})

test('every warning is tied to written syntax, has a concrete fix and clears after that repair', () => {
    for (const [broken, fixed] of [
        ['a=10; // [10:0:100]', 'a=10; // [10:100]'],
        ['a=10; // [100:10]', 'a=10; // [10:100]'],
        ['a=1; // [0:10', 'a=1; // [0:10]'],
        ['a=1; // 0', 'a=1; // 1'],
        ['a=1; // [1,,2]', 'a=1; // [1,2]'],
        ['a=101; // [0:100]', 'a=101; // [0:200]'],
        ['label="long"; // 2', 'label="long"; // 4'],
    ]) {
        const result = analyzeCustomizerSource(broken)
        assert.ok(result.diagnostics.length > 0, broken)
        assert.ok(result.diagnostics.every((d) => d.severity === 'warning' && !!d.suggestedFix && !!result.parameters[0].annotationRange), broken)
        assert.deepEqual(analyzeCustomizerSource(fixed).diagnostics, [], fixed)
        assert.deepEqual(analyzeCustomizerSource(broken.slice(0, broken.indexOf('//'))).diagnostics, [])
    }
})


test('closed bracket comments followed by prose are not falsely diagnosed as missing a bracket', () => {
    const comment = '// [0:22] IDs in Assembly.md; 0 shows the selected group'
    for (const ending of ['\n', '\r\n']) {
        const result = analyzeCustomizerSource(`assembly_id=0; ${comment}${ending}`)
        assert.deepEqual(result.diagnostics, [])
        assert.equal(result.parameters[0].widget, 'spinbox', 'Do not claim GUI range support for trailing prose the Parser does not consume')
        assert.deepEqual(codes(`// IDs in Assembly.md; 0 shows the selected group${ending}assembly_id=0; // [0:22]${ending}`), [])
    }
    assert.deepEqual(codes('name="a]b"; // ["a]b":"Label ]",other:Other] explanation'), [])
    assert.deepEqual(codes('assembly_id=0; // [0:22] see [IDs]'), [])
    assert.ok(codes('assembly_id=0; // [0:22').includes('CUSTOMIZER_MALFORMED_HINT'))
    assert.ok(codes('name="x"; // ["x]":Label').includes('CUSTOMIZER_MALFORMED_HINT'), 'A ] inside quotes does not close the hint')
})
