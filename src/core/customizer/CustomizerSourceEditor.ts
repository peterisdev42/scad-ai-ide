import { CapabilityError } from '../capabilities/CapabilityTypes'
import { scanCustomizer, parseLiteral, splitOutsideStrings } from './CustomizerParser'
import { analyzeCustomizerSource } from './CustomizerSourceAnalyzer'
import { validateCustomizerSource } from './CustomizerSourceValidator'
import type { SourceEditIntent, SourceExpectation, SourceTextEdit } from './CustomizerSourceTypes'

const reject = (message: string): never => { throw new CapabilityError('NEEDS_MANUAL_REVIEW', message) }
const lineText = (value: string) => { if (/[\r\n\u2028\u2029]/.test(value)) reject('Single-line metadata is required.'); return value }
function annotation(intent: SourceEditIntent): string {
    const { widget, range, choices } = intent
    if (widget === 'slider' || (widget === 'vector' && range)) {
        if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max || (range.step !== undefined && (!Number.isFinite(range.step) || range.step <= 0))) reject('Supply an ordered finite range and positive step.')
        return `[${range!.min}:${range!.step === undefined ? '' : range!.step + ':'}${range!.max}]`
    }
    if (widget === 'dropdown') {
        if (!choices?.length || choices.length > 100) reject('Supply a bounded, nonempty choice set.')
        return `[${choices!.map((c) => {
            // Quoting protects delimiters and string values that resemble numbers.
            const value = typeof c.value === 'string' ? JSON.stringify(lineText(c.value)) : String(c.value)
            return `${value}${c.label === undefined ? '' : ':' + JSON.stringify(lineText(c.label))}`
        }).join(', ')}]`
    }
    if (widget === 'spinbox' || widget === 'vector') {
        if (intent.step !== undefined && (!Number.isFinite(intent.step) || intent.step <= 0)) reject('Step must be positive.')
        return intent.step === undefined ? '' : String(intent.step)
    }
    if (widget === 'textbox') {
        if (intent.maxLength !== undefined && (!Number.isSafeInteger(intent.maxLength) || intent.maxLength < 0)) reject('Text length must be a nonnegative integer.')
        return intent.maxLength === undefined ? '' : String(intent.maxLength)
    }
    if (widget === 'checkbox') return ''
    return reject('A supported widget is required.')
}
export function applySourceEdits(source: string, edits: SourceTextEdit[]) {
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
    return source
}

/** Plan against one snapshot. All replacements are local; complex moves are refused. */
export function planCustomizerEdits(source: string, intents: SourceEditIntent[]) {
    if (!intents.length || intents.length > 50 || new Set(intents.map((i) => i.name.normalize('NFC'))).size !== intents.length) reject('Supply 1–50 distinct parameter intents.')
    if (!analyzeCustomizerSource(source).complete) throw new CapabilityError('SOURCE_UNSUPPORTED', 'Source is incomplete or exceeds analysis limits.')
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    let result = source
    const pieces: Array<{ text: string; origin?: number }> = [{ text: source, origin: 0 }]
    const split = (offset: number) => {
        let position = 0
        for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i]
            if (offset === position) return i
            if (offset < position + piece.text.length) {
                const cut = offset - position
                pieces.splice(i, 1, { text: piece.text.slice(0, cut), origin: piece.origin }, { text: piece.text.slice(cut), origin: piece.origin === undefined ? undefined : piece.origin + cut })
                return i + 1
            }
            position += piece.text.length
        }
        return pieces.length
    }
    const update = (edits: SourceTextEdit[]) => {
        for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
            const first = split(edit.start), last = split(edit.end)
            pieces.splice(first, last - first, ...(edit.text ? [{ text: edit.text }] : []))
        }
        result = applySourceEdits(result, edits)
    }
    const expectations: SourceExpectation[] = []
    const original = scanCustomizer(source)
    // Work backwards so an explicit group on a later target bounds an earlier group.
    const ordered = [...intents].sort((a, b) => (original.declarations.find((d) => d.name === b.name.normalize('NFC'))?.start ?? -1) - (original.declarations.find((d) => d.name === a.name.normalize('NFC'))?.start ?? -1))
    for (const intent of ordered) {
        if (!['annotateExisting', 'insertLiteralParameter', 'changeWidget', 'moveGroup', 'hideParameter'].includes(intent.kind)) reject('Unsupported edit intent.')
        if (!/^[\p{L}_$][\p{L}\p{N}\p{M}_$]*$/u.test(intent.name)) reject('Invalid parameter identifier.')
        const scan = scanCustomizer(result)
        const matches = scan.declarations.filter((d) => d.name === intent.name.normalize('NFC'))
        const existing = matches[0]
        if (intent.kind === 'insertLiteralParameter') {
            if (matches.length) {
                const { kind: _kind, ...expected } = intent
                if (matches.length === 1 && validateCustomizerSource(result, [expected]).semanticPass) { expectations.push(expected); continue }
                reject('Parameter already exists with a different contract; annotate it instead.')
            }
            if (intent.defaultValue === undefined || parseLiteral(JSON.stringify(intent.defaultValue)) === undefined) reject('Default must be a supported literal.')
            const group = intent.group ?? 'Global'
            if (!group || /[\[\]*\/\r\n]/.test(group)) reject('Invalid group name.')
            const hint = annotation(intent)
            const block = `/* [${group}] */${eol}${intent.description === undefined ? '' : '// ' + lineText(intent.description) + eol}${intent.name} = ${JSON.stringify(intent.defaultValue)};${hint ? ' // ' + hint : ''}${eol}`
            // Restore the first existing group; ungrouped declarations require manual placement.
            const first = scan.declarations[0]
            if (first && !first.group) reject('Insertion before ungrouped parameters requires manual placement or explicit grouping first.')
            update([{ start: source.startsWith('\ufeff') ? 1 : 0, end: source.startsWith('\ufeff') ? 1 : 0, text: block + (first ? `/* [${first.group}] */${eol}` : '') }])
        } else {
            if (matches.length !== 1 || !existing.beforeFirstBrace || existing.value === undefined) reject('A unique literal declaration before the first brace is required.')
            const lineStart = result.lastIndexOf('\n', existing.start - 1) + 1
            const lineEndIndex = result.indexOf('\n', existing.end)
            const lineEnd = lineEndIndex < 0 ? result.length : lineEndIndex
            if (result.slice(lineStart, existing.start).trim() || /\S/.test(result.slice(Math.max(existing.annotation?.end ?? 0, existing.end), lineEnd))) reject('Use a standalone declaration without adjacent code or block comments.')
            const local: SourceTextEdit[] = []
            if (intent.kind !== 'moveGroup' && intent.kind !== 'hideParameter') {
                const hint = annotation(intent)
                if (existing.annotation) {
                    const old = result.slice(existing.annotation.start + 2, existing.annotation.end).trim()
                    const closingParts = old.startsWith('[') ? splitOutsideStrings(old, ']') : []
                    if (closingParts.length > 1 && (closingParts.length !== 2 || closingParts[1])) reject('Preserve text after the bracketed comment; move the explanation to a separate comment before changing the Widget.')
                    if (old && !(old.startsWith('[') || /^[+-]?(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(old)) && !/^range\s*:\s*[+-]?[\d.]+\s*\.\.\s*[+-]?[\d.]+(?:\s+step\s+[\d.]+)?$/i.test(old)) reject('Preserve ordinary trailing comments; convert them manually.')
                    local.push({ start: existing.annotation.start, end: existing.annotation.end, text: hint ? '// ' + hint : '' })
                } else if (hint) {
                    // Native getComment reads the declaration's first line, including
                    // a vector that continues onto later lines.
                    const firstNewline = result.indexOf('\n', existing.start)
                    const offset = firstNewline >= 0 && firstNewline < existing.end ? firstNewline - (result[firstNewline - 1] === '\r' ? 1 : 0) : existing.end
                    local.push({ start: offset, end: offset, text: ' // ' + hint })
                }
            }
            let prefix = ''
            const group = intent.kind === 'hideParameter' ? 'Hidden' : intent.group
            if (group !== undefined && group !== existing.group) {
                if (!group || /[\[\]*\/\r\n]/.test(group)) reject('Invalid group name.')
                prefix += `/* [${group}] */${eol}`
                const next = scan.declarations.find((d) => d.start > existing.end)
                const between = result.slice(lineEnd, next?.start ?? result.length)
                if (next && !/\/\*\s*\[[^\]]+\]\s*\*\//.test(between)) {
                    if (!existing.group) reject('Moving this ungrouped parameter would change following parameters. Group later targets first.')
                    local.push({ start: lineEnd, end: lineEnd, text: eol + `/* [${existing.group}] */` })
                }
            }
            if (intent.description !== undefined) {
                if (existing.description) local.push({ start: existing.description.start, end: existing.description.end, text: '// ' + lineText(intent.description) })
                else prefix += '// ' + lineText(intent.description) + eol
            }
            if (prefix) {
                const start = existing.description ? result.lastIndexOf('\n', existing.description.start - 1) + 1 : lineStart
                local.push({ start, end: start, text: prefix })
            }
            update(local)
        }
        const { kind: _kind, ...expected } = intent
        expectations.push(intent.kind === 'hideParameter' ? { name: intent.name, visible: false } : expected)
    }
    const targets = new Set(intents.map((i) => i.name.normalize('NFC')))
    const finalScan = scanCustomizer(result)
    const unchanged = (scan: ReturnType<typeof scanCustomizer>) => scan.declarations.filter((d) => !targets.has(d.name)).map((d) => ({ name: d.name, value: d.value, group: d.group, beforeFirstBrace: d.beforeFirstBrace, parameter: d.parameter }))
    if (JSON.stringify(unchanged(original)) !== JSON.stringify(unchanged(finalScan))) reject('The edit would change another declaration or its Customizer meaning.')
    const validation = validateCustomizerSource(result, expectations)
    if (!validation.semanticPass) throw new CapabilityError('POSTCONDITION_FAILED', `Plan does not meet its contract: ${[...validation.diagnostics.map((d) => d.message), ...validation.expectationResults.flatMap((result) => result.issues.map((issue) => `${result.parameter}: ${issue}`))].join('; ').slice(0, 2000)}`)
    const edits: SourceTextEdit[] = []
    let cursor = 0, pending = ''
    for (const piece of pieces) {
        if (piece.origin === undefined) { pending += piece.text; continue }
        if (piece.origin > cursor || pending) {
            if (source.slice(cursor, piece.origin) !== pending) edits.push({ start: cursor, end: piece.origin, text: pending })
            pending = ''
        }
        cursor = piece.origin + piece.text.length
    }
    if (cursor < source.length || pending) {
        if (source.slice(cursor) !== pending) edits.push({ start: cursor, end: source.length, text: pending })
    }
    if (edits.length > 50) throw new CapabilityError('LIMIT_EXCEEDED', 'Plan exceeds 50 source edits; use a smaller batch.')
    return { edits, source: result, expectations, validation, changedParameters: intents.map((i) => i.name) }
}
