import * as vscode from 'vscode'
import { Registry, type IRawGrammar, type StateStack } from 'vscode-textmate'
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma'
import { loadScadTheme } from '../markdown/ScadTheme'

let onigurumaReady: Promise<void> | undefined

/** Use the installed VS Code JSON grammar and the same theme resolver as SCAD embeds. */
export async function highlightJson(value: unknown, extensionUri: vscode.Uri) {
    const text = JSON.stringify(value, null, 2) ?? 'undefined'
    if (text.length > 1048576) return [{ text, color: undefined, font: 0 }]
    const json = vscode.extensions.getExtension('vscode.json')
    const contribution = json?.packageJSON.contributes?.grammars?.find((grammar: { scopeName: string }) => grammar.scopeName === 'source.json')
    if (!json || !contribution) throw new Error('VS Code JSON grammar is unavailable.')
    onigurumaReady ??= Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'dist', 'onig.wasm'))).then((bytes) => loadWASM(bytes))
    await onigurumaReady
    const grammar = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(json.extensionUri, contribution.path))).toString('utf8')) as IRawGrammar
    const registry = new Registry({
        theme: await loadScadTheme(),
        onigLib: Promise.resolve({ createOnigScanner: (patterns) => new OnigScanner(patterns), createOnigString: (text) => new OnigString(text) }),
        loadGrammar: async (scope) => scope === grammar.scopeName ? grammar : null,
    })
    try {
        const tokenizer = await registry.loadGrammar(grammar.scopeName)
        if (!tokenizer) throw new Error('Could not load the JSON grammar.')
        const colors = registry.getColorMap()
        const result: { text: string; color: string | undefined; font: number }[] = []
        let stack: StateStack | null = null
        for (const [lineIndex, line] of text.split('\n').entries()) {
            if (lineIndex) result.push({ text: '\n', color: undefined, font: 0 })
            const tokens = tokenizer.tokenizeLine2(line, stack)
            stack = tokens.ruleStack
            for (let i = 0; i < tokens.tokens.length; i += 2) {
                const metadata = tokens.tokens[i + 1]
                const color = colors[(metadata >>> 15) & 0x1ff]
                result.push({ text: line.slice(tokens.tokens[i], tokens.tokens[i + 2] ?? line.length), color: /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color) ? color : undefined, font: (metadata >>> 11) & 0xf })
            }
        }
        return result
    } finally { registry.dispose() }
}
