import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(__dirname, '../..')
const json = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))
const configuration = json('language-configuration.json')

test('indentation rules handle SCAD blocks, vectors, calls and comment lines', () => {
    const increase = new RegExp(configuration.indentationRules.increaseIndentPattern)
    const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern)
    for (const line of ['module shape() {', 'points = [', 'translate(', 'difference() { // cut']) {
        assert.ok(increase.test(line), line)
    }
    for (const line of ['// module shape() {', 'cube(10);', 'x = "{";', 'cube([1, 2, 3]);']) {
        assert.equal(increase.test(line), false, line)
    }
    for (const line of ['}', '  ];', '  );']) {
        assert.ok(decrease.test(line), line)
    }
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
    const { Registry } = require('vscode-textmate') as typeof import('vscode-textmate')
    const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma') as typeof import('vscode-oniguruma')
    await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')))
    const registry = new Registry({
        onigLib: Promise.resolve({ createOnigScanner: (patterns) => new OnigScanner(patterns), createOnigString: (text) => new OnigString(text) }),
        loadGrammar: async () => json('syntaxes/openscad.tmLanguage.json'),
    })
    try {
        const grammar = (await registry.loadGrammar('source.openscad'))!
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
    } finally {
        registry.dispose()
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
