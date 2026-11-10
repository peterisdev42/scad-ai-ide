/** Extract the parser diagnostic without the CLI exit status and output noise. */
export function syntaxErrorMessage(error: Error): string | undefined {
    const diagnostic = error.message.match(/^\s*(?:ERROR:\s*)?Parser error:\s*([^\r\n]+)/im)?.[1]?.trim()
    if (!diagnostic) return undefined
    return /^syntax error\b/i.test(diagnostic) ? diagnostic[0].toUpperCase() + diagnostic.slice(1) : `Syntax error: ${diagnostic}`
}

/** Bounded, deduplicated CLI errors; runtime/graphics failures remain errors even
 * without a source location. Never infer an error location from a nearby warning. */
export function previewErrorDetails(error: unknown): Array<{ message: string; file?: string; line?: number }> {
    const raw = error instanceof Error ? error.message : String(error)
    const text = raw.length <= 262144 ? raw : raw.slice(0, 131072) + '\n[Preview error truncated]\n' + raw.slice(-131072)
    const lines = text.split(/\r?\n/)
    const errors = [...new Set(lines.filter(line => /^\s*(?:ERROR:|Parser error:)/i.test(line)).map(line => line.trim()))].slice(0, 20)
    return (errors.length ? errors : [text || 'Preview failed without an error message.']).map(message => {
        const location = /\bin file\s+(.+?),\s*line\s+(\d+)/i.exec(message)
        const line = location ? Number(location[2]) : undefined
        return { message: message.slice(0, 8192), ...(location && line && Number.isSafeInteger(line) ? { file: location[1].replace(/^['"]|['"]$/g, ''), line: Math.min(line, 2147483647) } : {}) }
    })
}

/** Keep bounded output context and preserve the first distinct errors even when
 * recursion floods stderr with warnings. Chunks need not align with lines. */
export class PreviewOutput {
    private head = ''
    private tail = ''
    private fragment = ''
    private readonly errors = new Set<string>()
    append(chunk: string) {
        const remaining = Math.max(0, 65536 - this.head.length)
        this.head += chunk.slice(0, remaining)
        if (chunk.length > remaining) this.tail = (this.tail + chunk.slice(remaining)).slice(-65536)
        const lines = (this.fragment + chunk).split(/\r?\n/)
        this.fragment = lines.pop()!.slice(0, 8192)
        for (const line of lines) this.remember(line)
    }
    private remember(line: string) {
        if (this.errors.size < 20 && /^\s*(?:ERROR:|Parser error:)/i.test(line)) this.errors.add(line.trim().slice(0, 8192))
    }
    get hasErrors() { this.remember(this.fragment); return this.errors.size > 0 }
    get text() { this.remember(this.fragment); return [...this.errors, this.head, ...(this.tail ? ['[OpenSCAD output truncated]', this.tail] : [])].join('\n') }
}
