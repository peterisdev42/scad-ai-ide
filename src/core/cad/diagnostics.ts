import type { CliDiagnostic } from './types'

/** Parse complete bounded lines, retaining original text when a runtime format is unknown. */
export function normalizeCliDiagnostics(text: string, exitCode: number | null): CliDiagnostic[] {
    const results: CliDiagnostic[] = []
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*TRACE:/i.test(line)) {
            const issue = results.at(-1)
            if (issue && issue.trace.length < 20) issue.trace.push(line.trim().slice(0, 2048))
            continue
        }
        if (!/^\s*(ERROR:|WARNING:|Parser error:)/i.test(line)) continue
        const message = line.trim().slice(0, 8192)
        let code = /^\s*WARNING:/i.test(line) ? 'SCAD_CLI_WARNING' : 'SCAD_CLI_ERROR'
        let incomplete = false
        if (/Parser error:/i.test(line)) code = 'SCAD_CLI_PARSER_ERROR'
        else if (/assert(?:ion)?.*(?:fail|false)/i.test(line)) code = 'SCAD_CLI_ASSERT_FAILED'
        else if (/unknown (?:module|function)/i.test(line)) {
            code = 'SCAD_CLI_UNKNOWN_SYMBOL'
            incomplete = true
        } else if (/(?:can't|cannot|could not|unable to) (?:open|find) (?:include|use|library|import)|(?:include|use).*not found/i.test(line)) {
            code = 'SCAD_CLI_DEPENDENCY_MISSING'
            incomplete = true
        }
        const location = /\bin file\s+(.+?),?\s*(?:,\s*)?line\s+(\d+)(?:\D|$)/i.exec(message) ?? /\bin file\s+(.+?),\s*line\s+(\d+)/i.exec(message)
        const lineNumber = location ? Number(location[2]) : undefined
        results.push({ code, message, severity: /^\s*WARNING:/i.test(line) ? 'warning' : 'error', ...(location && lineNumber && Number.isSafeInteger(lineNumber) ? { file: location[1].replace(/[,\s]+$/, '').replace(/^['"]|['"]$/g, ''), line: Math.min(lineNumber, 2147483647) - 1 } : {}), trace: [], incomplete })
    }
    if (exitCode !== 0 && !results.some((d) => d.severity === 'error')) results.push({ code: 'SCAD_CLI_UNCLASSIFIED_ERROR', severity: 'error', message: `OpenSCAD exited with code ${exitCode}. ${text.slice(-4096)}`, trace: [] })
    const unique = [...new Map(results.map((d) => [`${d.code}:${d.message}`, d])).values()]
    if (unique.length <= 200) return unique
    return [...unique.filter((d) => d.severity === 'error').slice(0, 100), ...unique.filter((d) => d.severity !== 'error').slice(0, 99), { code: 'SCAD_CLI_DIAGNOSTICS_TRUNCATED', message: 'Diagnostic count exceeded its budget.', severity: 'warning', trace: [], incomplete: true }]
}

/** Streaming UTF-8 is decoded by the caller. Both stored text and unfinished lines are bounded. */
export class BoundedCliLog {
    private head = ''
    private tail = ''
    private fragment = ''
    private important = new Set<string>()
    private errors = new Set<string>()
    private dropped = false
    private bytes = 0
    append(text: string) {
        this.bytes += Buffer.byteLength(text)
        const remaining = Math.max(0, 32768 - this.head.length)
        this.head += text.slice(0, remaining)
        if (text.length > remaining) this.tail = (this.tail + text.slice(remaining)).slice(-32768)
        const lines = (this.fragment + text).split(/\r?\n/)
        this.fragment = lines.pop()!.slice(0, 8192)
        for (const line of lines) this.remember(line)
    }
    private remember(line: string) {
        if (!/^\s*(?:ERROR:|WARNING:|Parser error:|TRACE:)/i.test(line)) return
        if (line.length > 8192) this.dropped = true
        const bounded = line.slice(0, 8192)
        if (/^\s*(?:ERROR:|Parser error:)/i.test(line)) {
            if (this.errors.size < 100) this.errors.add(bounded)
            else if (!this.errors.has(bounded)) this.dropped = true
        }
        if (this.important.size < 100) this.important.add(bounded)
        else if (!this.important.has(bounded)) this.dropped = true
    }
    get truncated() {
        return this.bytes > 65536 || this.dropped
    }
    get text() {
        this.remember(this.fragment)
        return [...this.errors, this.head, ...(this.truncated ? ['[OpenSCAD output truncated]'] : []), this.tail, ...this.important].join('\n')
    }
}
