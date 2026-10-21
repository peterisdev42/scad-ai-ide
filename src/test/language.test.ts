import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(__dirname, '../..')
const json = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))
const configuration = json('language-configuration.json')
let onigurumaReady: Promise<void> | undefined

async function textmate(theme?: import('vscode-textmate').IRawTheme) {
    const { Registry } = require('vscode-textmate') as typeof import('vscode-textmate')
    const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma') as typeof import('vscode-oniguruma')
    onigurumaReady ??= loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')))
    await onigurumaReady
    const registry = new Registry({
        theme,
        onigLib: Promise.resolve({ createOnigScanner: (patterns) => new OnigScanner(patterns), createOnigString: (text) => new OnigString(text) }),
        loadGrammar: async () => json('syntaxes/openscad.tmLanguage.json'),
    })
    return { registry, grammar: (await registry.loadGrammar('source.openscad'))! }
}

test('indentation rules handle SCAD blocks, vectors, calls and comment lines', () => {
    const increase = new RegExp(configuration.indentationRules.increaseIndentPattern)
    const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern)
    for (const line of ['module shape() {', 'points = [', 'translate(', 'difference() { // cut', 'points = [ [1, 2],', 'echo("text",', 'value = 10 / (2 +', '/* note */ difference() {', 'values = ["text", // values']) {
        assert.ok(increase.test(line), line)
    }
    for (const line of ['// module shape() {', 'cube(10);', 'x = "{";', 'cube([1, 2, 3]);', 'echo("(");', 'echo("escaped \\\" {");', '/* { */', 'cube(10); // {', 'value = "// [";', 'x = [1, 2]; // (']) {
        assert.equal(increase.test(line), false, line)
    }
    for (const line of ['}', '  ];', '  );']) {
        assert.ok(decrease.test(line), line)
    }
})

test('single-statement bodies indent once without treating complete statements or expressions as headers', () => {
    const next = new RegExp(configuration.indentationRules.indentNextLinePattern)
    for (const line of ['if (enabled)', 'else if (size > 1)', 'else', 'for (i = [0:10])', 'intersection_for (i = [0:2])', 'let (size = max(1, width))', 'translate([1, 2, 3])', 'translate([0, 0, 1]) rotate([0, 90, 0])', '#difference() // geometry', 'echo("{ ; }")', 'if (enabled) // comment {']) {
        assert.ok(next.test(line), line)
    }
    for (const line of ['cube(10);', 'if (enabled) cube(10);', 'if (enabled) {', '// translate([0, 0, 1])', '/* for (i = [0:1]) */', 'x = sin(30)', 'function f(x) = sin(x)', 'echo("unterminated)']) {
        assert.equal(next.test(line), false, line)
    }
})

test('block comment Enter rules continue stars and leave completed comments', () => {
    const rules = configuration.onEnterRules as { beforeText: string; afterText?: string; previousLineText?: string; action: { indent: string; appendText?: string; removeText?: number } }[]
    const match = (before: string, after = '', previous = '') => rules.find((rule) => new RegExp(rule.beforeText).test(before) && (!rule.afterText || new RegExp(rule.afterText).test(after)) && (!rule.previousLineText || new RegExp(rule.previousLineText).test(previous)))?.action
    assert.deepEqual(match('/*', ' */'), { indent: 'indentOutdent', appendText: ' * ' })
    assert.deepEqual(match('    /* description'), { indent: 'none', appendText: ' * ' })
    assert.deepEqual(match('     * description', '', '    /*'), { indent: 'none', appendText: '* ' })
    assert.deepEqual(match('     */'), { indent: 'none', removeText: 1 })
    for (const line of ['echo("/*");', '/* done */', '// /*']) {
        assert.equal(match(line), undefined, line)
    }
    assert.equal(match('    * 2', '', 'value = 3'), undefined)
})

test('fold markers accept regions and do not treat geometry or customizer headers as markers', () => {
    const start = new RegExp(configuration.folding.markers.start)
    const end = new RegExp(configuration.folding.markers.end)
    assert.ok(start.test('  // #region Geometry'))
    assert.ok(start.test('// region Geometry'))
    assert.ok(end.test('  // #endregion'))
    for (const line of ['/* [Geometry] */', 'module region() {', '// regional']) {
        assert.equal(start.test(line), false)
    }
})

test('language contributions resolve packaged assets and preserve editor pairs', () => {
    const manifest = json('package.json')
    const language = manifest.contributes.languages.find((entry: { id: string }) => entry.id === 'openscad')
    assert.ok(language.extensions.includes('.scad'))
    assert.deepEqual(json(language.configuration), configuration)
    const grammar = json(manifest.contributes.grammars[0].path)
    assert.equal(grammar.scopeName, manifest.contributes.grammars[0].scopeName)
    const snippets = json(manifest.contributes.snippets[0].path)
    assert.ok(snippets.Module.body.join('\n').includes('$0'))
    assert.ok(snippets.Region.body[0].startsWith('// #region'))
    assert.deepEqual(configuration.comments, { lineComment: '//', blockComment: ['/*', '*/'] })
    for (const pair of [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ]) {
        assert.ok(configuration.brackets.some((entry: string[]) => entry.join('') === pair.join('')))
        assert.ok(configuration.surroundingPairs.some((entry: string[]) => entry.join('') === pair.join('')))
    }
})

test('TextMate tokenization distinguishes declarations, paths, numbers and multiline strings/comments', async () => {
    const { registry, grammar } = await textmate()
    try {
        const lines: [string, string, string][] = [
            ['module gear(size = 1e-3) {', 'gear', 'entity.name.function.openscad'],
            ['include <my-library/gears.scad>', 'gears', 'string.unquoted.path.openscad'],
            ['value = 1e-3;', '1e-3', 'constant.numeric.openscad'],
            ['echo("// cube(3)");', 'cube', 'string.quoted.double.openscad'],
            ['$fn = 32;', '$fn', 'variable.language.special.openscad'],
            ['/* comment starts', 'starts', 'comment.block.openscad'],
        ]
        for (const [line, word, scope] of lines) {
            const result = grammar.tokenizeLine(line, null)
            assert.ok(result.tokens.find((token) => token.startIndex <= line.indexOf(word) && token.endIndex > line.indexOf(word))?.scopes.includes(scope), line)
        }
        const state = grammar.tokenizeLine('/* multiline', null).ruleStack
        assert.ok(grammar.tokenizeLine('cube(10); */', state).tokens[0].scopes.includes('comment.block.openscad'))
        const stringState = grammar.tokenizeLine('label = "first line', null).ruleStack
        const continued = grammar.tokenizeLine('module fake(size) // still a string";', stringState)
        assert.ok(continued.tokens[0].scopes.includes('string.quoted.double.openscad'))
        const recovered = grammar.tokenizeLine('width = 40;', continued.ruleStack)
        assert.ok(recovered.tokens[0].scopes.includes('variable.other.readwrite.openscad'))
    } finally {
        registry.dispose()
    }
})

test('TextMate scopes distinguish multiline parameters, nested defaults, named arguments and variable references', async () => {
    const { registry, grammar } = await textmate()
    try {
        let state: import('vscode-textmate').StateStack | null = null
        const lines: [string, [string, string][]][] = [
            [
                'module bracket(',
                [
                    ['module', 'storage.type.function.openscad'],
                    ['bracket', 'entity.name.function.openscad'],
                ],
            ],
            [
                '    size = [max(width, 2), 24],',
                [
                    ['size', 'variable.parameter.openscad'],
                    ['max', 'entity.name.function.call.openscad'],
                    ['width', 'variable.other.readwrite.openscad'],
                    ['24', 'constant.numeric.openscad'],
                ],
            ],
            [
                '    wall = 2.5, centered = true',
                [
                    ['wall', 'variable.parameter.openscad'],
                    ['centered', 'variable.parameter.openscad'],
                    ['true', 'constant.language.openscad'],
                ],
            ],
            [') {', [['{', 'punctuation.section.block.openscad']]],
            [
                '    cube(size, center = centered);',
                [
                    ['cube', 'entity.name.function.call.openscad'],
                    ['size', 'variable.other.readwrite.openscad'],
                    ['center', 'variable.parameter.named.openscad'],
                    ['centered', 'variable.other.readwrite.openscad'],
                ],
            ],
            ['    $fn = 72;', [['$fn', 'variable.language.special.openscad']]],
            [
                '    for (i = [0:3]) translate([i * wall, 0, 0]) bracket();',
                [
                    ['for', 'keyword.control.openscad'],
                    ['i', 'variable.other.readwrite.openscad'],
                    ['translate', 'entity.name.function.call.openscad'],
                    ['wall', 'variable.other.readwrite.openscad'],
                    ['bracket', 'entity.name.function.call.openscad'],
                ],
            ],
            ['}', []],
            [
                'function clamp01(value) = min(1, max(0, value));',
                [
                    ['function', 'storage.type.function.openscad'],
                    ['clamp01', 'entity.name.function.openscad'],
                    ['value', 'variable.parameter.openscad'],
                    ['min', 'entity.name.function.call.openscad'],
                ],
            ],
            [
                'mapping = function(x) x * factor;',
                [
                    ['mapping', 'variable.other.readwrite.openscad'],
                    ['x', 'variable.parameter.openscad'],
                    ['factor', 'variable.other.readwrite.openscad'],
                ],
            ],
            [
                'result = clamp01(width);',
                [
                    ['result', 'variable.other.readwrite.openscad'],
                    ['clamp01', 'entity.name.function.call.openscad'],
                    ['width', 'variable.other.readwrite.openscad'],
                ],
            ],
        ]
        for (const [line, expectations] of lines) {
            const result = grammar.tokenizeLine(line, state)
            state = result.ruleStack
            for (const [word, scope] of expectations) {
                const index = line.indexOf(word)
                const scopes = result.tokens.find((token) => token.startIndex <= index && token.endIndex > index)?.scopes
                assert.ok(scopes?.includes(scope), `${line}: ${word}: ${scopes?.join(' ')}`)
            }
        }
        for (const line of ['echo("cube(size = 10) // module fake()");', '/* module fake(size = width) { */']) {
            const result = grammar.tokenizeLine(line, null)
            const index = line.indexOf('size')
            const scopes = result.tokens.find((token) => token.startIndex <= index && token.endIndex > index)!.scopes
            assert.ok(scopes.some((scope) => scope.startsWith(line.startsWith('/*') ? 'comment.' : 'string.')))
            assert.equal(
                scopes.some((scope) => scope.startsWith('variable.')),
                false,
            )
        }
    } finally {
        registry.dispose()
    }
})

test('standard scopes receive distinct JS/TS-style colors without language-specific theme overrides', async () => {
    // Representative Dark+/Light+ rules from VS Code theme-defaults. Only
    // standard parent scopes are supplied: no .openscad or .ts selectors.
    // https://github.com/microsoft/vscode/tree/main/extensions/theme-defaults/themes
    for (const colors of [
        { plain: '#D4D4D4', variable: '#9CDCFE', callable: '#DCDCAA', keyword: '#C586C0', storage: '#569CD6', number: '#B5CEA8', string: '#CE9178', comment: '#6A9955' },
        { plain: '#000000', variable: '#001080', callable: '#795E26', keyword: '#AF00DB', storage: '#0000FF', number: '#098658', string: '#A31515', comment: '#008000' },
    ]) {
        const settings = [{ settings: { foreground: colors.plain, background: '#FFFFFF' } }, ...(['variable', 'callable', 'keyword', 'storage', 'number', 'string', 'comment'] as const).map((key) => ({ scope: { variable: 'variable', callable: 'entity.name.function', keyword: 'keyword.control', storage: 'storage.type', number: 'constant.numeric', string: 'string', comment: 'comment' }[key], settings: { foreground: colors[key] } }))]
        const { registry, grammar } = await textmate({ settings })
        try {
            for (const [line, word, color] of [
                ['width = 40;', 'width', colors.variable],
                ['module bracket(wall = 2) {}', 'wall', colors.variable],
                ['cube(size = width);', 'size', colors.variable],
                ['cube(width);', 'cube', colors.callable],
                ['module bracket() {}', 'bracket', colors.callable],
                ['module bracket() {}', 'module', colors.storage],
                ['if (enabled)', 'if', colors.keyword],
                ['width = 40;', '40', colors.number],
                ['color("steelblue")', 'steelblue', colors.string],
                ['// model notes', 'notes', colors.comment],
            ]) {
                const { tokens } = grammar.tokenizeLine2(line, null)
                const index = line.indexOf(word)
                let metadata = 0
                for (let i = 0; i < tokens.length && tokens[i] <= index; i += 2) {
                    metadata = tokens[i + 1]
                }
                const foreground = registry.getColorMap()[(metadata >>> 15) & 0x1ff]
                assert.equal(foreground, color, `${line}: ${word}`)
                assert.notEqual(foreground, colors.plain)
            }
        } finally {
            registry.dispose()
        }
    }
})

test('server resolution uses bundle before PATH and rejects an invalid explicit override', async () => {
    const { mkdtemp, mkdir, writeFile, chmod, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { resolveLanguageServer } = await import('../platform/language/serverExecutable.js')
    const directory = await mkdtemp(path.join(tmpdir(), 'scad-lsp-resolution-'))
    const name = process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp'
    const bundled = path.join(directory, 'bundle', name)
    const installed = path.join(directory, 'bin', name)
    const missing = path.join(directory, 'missing')
    try {
        for (const file of [bundled, installed]) {
            await mkdir(path.dirname(file), { recursive: true })
            await writeFile(file, 'test fixture')
            await chmod(file, 0o755)
        }
        assert.equal(await resolveLanguageServer(bundled, '', path.dirname(installed)), bundled)
        assert.equal(await resolveLanguageServer(bundled, installed, ''), installed)
        await assert.rejects(resolveLanguageServer(bundled, missing, path.dirname(installed)), /missing or not executable/)
        await assert.rejects(resolveLanguageServer(bundled, 'relative-server', ''), /absolute/)
        assert.equal(await resolveLanguageServer(missing, '', path.dirname(installed)), installed)
        await assert.rejects(resolveLanguageServer(missing, '', '.'), /not found/)
        if (process.platform !== 'win32') {
            await chmod(installed, 0o644)
            await assert.rejects(resolveLanguageServer(missing, '', path.dirname(installed)), /not found/)
        }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
