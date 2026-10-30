import { readFile } from 'node:fs/promises'
import { Registry, type IGrammar, type IRawGrammar, type IRawTheme, type StateStack } from 'vscode-textmate'
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma'

const grammarSource = require('../../../syntaxes/openscad.tmLanguage.json') as IRawGrammar
let onigurumaReady: Promise<void> | undefined

/** Use the editor's grammar and TextMate theme matching, including font styles. */
export class ScadHighlighter {
    private registry?: Registry
    private grammar?: IGrammar
    private initialization?: Promise<void>
    private disposed = false
    private theme?: IRawTheme

    initialize(wasmPath: string): Promise<void> {
        return (this.initialization ??= this.load(wasmPath))
    }

    private async load(wasmPath: string): Promise<void> {
        onigurumaReady ??= readFile(wasmPath).then((wasm) => loadWASM(wasm))
        await onigurumaReady
        if (this.disposed) return
        const registry = new Registry({
            theme: this.theme,
            onigLib: Promise.resolve({ createOnigScanner: (patterns) => new OnigScanner(patterns), createOnigString: (text) => new OnigString(text) }),
            loadGrammar: async (scope) => (scope === grammarSource.scopeName ? grammarSource : null),
        })
        this.registry = registry
        const grammar = await registry.loadGrammar(grammarSource.scopeName)
        if (!this.disposed && grammar) this.grammar = grammar
    }

    setTheme(theme: IRawTheme) {
        this.theme = theme
        this.registry?.setTheme(theme)
    }

    highlight(source: string, escape: (text: string) => string): string {
        if (!this.grammar) return escape(source)
        const colors = this.registry!.getColorMap()
        let state: StateStack | null = null
        const highlighted = source
            .split('\n')
            .map((line) => {
                const result = this.grammar!.tokenizeLine(line, state)
                const themed = this.grammar!.tokenizeLine2(line, state)
                state = themed.ruleStack
                let themeIndex = 0
                return result.tokens
                    .map((token) => {
                        const text = escape(line.slice(token.startIndex, token.endIndex))
                        const scope = [...token.scopes].reverse().find((scope) => /^(comment|constant|entity\.name\.function|keyword|storage|variable|string)\./.test(scope))
                        const className = scope?.startsWith('comment.') ? 'hljs-comment' : scope?.startsWith('string.') ? 'hljs-string' : scope?.startsWith('constant.numeric.') ? 'hljs-number' : scope?.startsWith('constant.') ? 'hljs-literal' : scope?.startsWith('entity.name.function.') ? 'hljs-title' : scope?.startsWith('variable.parameter.') ? 'hljs-params' : scope?.startsWith('variable.') ? 'hljs-variable' : scope?.startsWith('keyword.') || scope?.startsWith('storage.') ? 'hljs-keyword' : undefined
                        while (themeIndex + 2 < themed.tokens.length && themed.tokens[themeIndex + 2] <= token.startIndex) themeIndex += 2
                        // vscode-textmate's encoded token layout: font style at bit 11,
                        // foreground color-map index at bit 15 (9 bits).
                        const metadata = themed.tokens[themeIndex + 1]
                        const color = colors[(metadata >>> 15) & 0x1ff]
                        const font = (metadata >>> 11) & 0xf
                        const decorations = [font & 4 ? 'underline' : '', font & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'
                        const style = `${/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color) ? `color:${color};` : ''}font-style:${font & 1 ? 'italic' : 'normal'};font-weight:${font & 2 ? 'bold' : 'normal'};text-decoration:${decorations}`
                        return text ? `<span${className ? ` class="${className}"` : ''} style="${style}">${text}</span>` : ''
                    })
                    .join('')
            })
            .join('\n')
        return `<span class="scad-markdown-code">${highlighted}</span>`
    }

    dispose() {
        this.disposed = true
        this.grammar = undefined
        this.registry?.dispose()
    }
}
