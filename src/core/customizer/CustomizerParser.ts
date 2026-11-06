import type { Parameter, ParameterValue } from './CustomizerModel'
export type { Parameter, ParameterValue } from './CustomizerModel'

export { parseLiteral } from './CustomizerLiteral'
export { splitOutsideStrings } from './CustomizerAnnotation'
import { parseLiteral } from './CustomizerLiteral'
import { annotate } from './CustomizerAnnotation'

/** Scan source without evaluating expressions or following includes. Only standalone
 * literal assignments before the first real opening brace are customizable. */
export interface SourceSpan { start: number; end: number }
export interface ScannedDeclaration {
    name: string
    group: string
    start: number
    end: number
    value?: ParameterValue
    parameter?: Parameter
    declaredChoices?: Parameter['choices']
    annotation?: SourceSpan
    description?: SourceSpan
    beforeFirstBrace: boolean
}

export function scanCustomizer(source: string) {
    const declarations: ScannedDeclaration[] = []
    let complete = true
    const incompleteReasons = new Set<string>()
    let lineStart = 0
    let lineEnd = source.indexOf('\n')
    const firstContent = (start: number, end: number) => {
        for (let i = start; i < (end < 0 ? source.length : end); i++) { if (!/\s/.test(source[i])) return i }
        return -1
    }
    let firstOnLine = firstContent(lineStart, lineEnd)
    let statementStart = -1
    let statementAnnotation: SourceSpan | undefined
    let statementDescriptionSpan: SourceSpan | undefined
    const precedingDescription = (offset: number) => {
        const currentLine = source.lastIndexOf('\n', offset - 1) + 1
        if (currentLine === 0) return undefined
        const end = currentLine - (source[currentLine - 2] === '\r' ? 2 : 1)
        const start = source.lastIndexOf('\n', currentLine - 2) + 1
        return source.startsWith('//', start) ? { start, end } : undefined
    }
    let lastDeclaration: ScannedDeclaration | undefined
    const parameters = new Map<string, Parameter>()
    let group = ''
    let pendingGroup: { name: string; after: number } | undefined
    let statementGroup = ''
    let lineSemicolons = 0
    let statement = ''
    let statementHasContent = false
    let depth = 0
    let braceDepth = 0
    let beforeFirstBrace = true
    let lastParameter: Parameter | undefined
    let statementDescription = ''
    const stopCustomizerAtLine = (offset: number) => {
        if (beforeFirstBrace) {
            const cutoff = source.lastIndexOf('\n', offset - 1) + 1
            for (let d = declarations.length - 1; d >= 0 && declarations[d].start >= cutoff; d--) {
                const declaration = declarations[d]
                declaration.beforeFirstBrace = false
                if (parameters.get(declaration.name) === declaration.parameter) parameters.delete(declaration.name)
                declaration.parameter = undefined
            }
        }
        beforeFirstBrace = false
    }
    for (let index = 0; index < source.length; index++) {
        const char = source[index]
        if (pendingGroup && index > pendingGroup.after) { group = pendingGroup.name; pendingGroup = undefined }
        if (char === '\n') lineSemicolons = 0
        if (char === '"') {
            statementHasContent = true
            statement += char
            while (++index < source.length) {
                statement += source[index]
                if (source[index] === '\n') lineSemicolons = 0
                if (source[index] === '\\') {
                    statement += source[++index] ?? ''
                } else if (source[index] === '"') {
                    break
                }
            }
            if (index >= source.length) { complete = false; incompleteReasons.add('unterminatedString') }
            continue
        }
        if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
            const block = source[index + 1] === '*'
            const end = source.indexOf(block ? '*/' : '\n', index + 2)
            const stop = end < 0 ? source.length : end
            if (block && end < 0) { complete = false; incompleteReasons.add('unterminatedBlockComment') }
            const comment = source.slice(index + 2, stop).trim()
            while (lineEnd >= 0 && lineEnd < index) {
                lineStart = lineEnd + 1
                lineEnd = source.indexOf('\n', lineStart)
                firstOnLine = firstContent(lineStart, lineEnd)
            }
            const standalone = firstOnLine === index
            if (braceDepth) {
                index = stop + (block && end >= 0 ? 1 : -1)
                continue
            }
            // collectGroups accepts every single-line block, including an empty
            // group reset. A heading only applies to declarations on later lines.
            if (block && !source.slice(index, stop).includes('\n')) {
                const heading = [...comment.matchAll(/\[([^\]]*)\]/g)].map(match => match[1]).join('-').trim()
                pendingGroup = { name: heading, after: lineEnd < 0 ? source.length : lineEnd }
            } else if (!block && statementHasContent && lineSemicolons === 0 && source.lastIndexOf('\n', statementStart - 1) === source.lastIndexOf('\n', index - 1)) {
                statementAnnotation = { start: index, end: stop - (source[stop - 1] === '\r' ? 1 : 0) }
            } else if (!block && lastDeclaration && !standalone && lineSemicolons === 1 && source.lastIndexOf('\n', lastDeclaration.start - 1) === source.lastIndexOf('\n', index - 1)) {
                if (lastParameter) lastDeclaration.declaredChoices = annotate(lastParameter, comment)
                lastDeclaration.annotation = { start: index, end: stop - (source[stop - 1] === '\r' ? 1 : 0) }
            }
            if (block && source.slice(index, stop).includes('\n')) lineSemicolons = 0
            statement += ' '
            index = stop + (block && end >= 0 ? 1 : -1)
            continue
        }
        if (char === '<' && /^\s*(?:include|use)\s*$/.test(statement)) {
            // Library directives have no required semicolon; do not swallow the next assignment.
            const end = source.indexOf('>', index + 1)
            if (end < 0) { complete = false; incompleteReasons.add('unterminatedInclude'); break }
            // Pinned CommentParser's cutoff scans raw angle paths. Reproduce its
            // brace-in-filename quirk without treating the path as SCAD syntax.
            const brace = source.slice(index + 1, end).indexOf('{')
            if (brace >= 0) stopCustomizerAtLine(index + 1 + brace)
            index = end
            statement = ''
            statementHasContent = false
            statementStart = -1
            continue
        }
        if (char === '{' || char === '}') {
            stopCustomizerAtLine(index)
            beforeFirstBrace = false
            braceDepth += char === '{' ? 1 : -1
            statement = ''
            statementHasContent = false
            statementStart = -1
            lastParameter = undefined
            lastDeclaration = undefined
            depth = 0
            continue
        }
        if (braceDepth) continue
        if (char === '\n') {
            lastParameter = undefined
            lastDeclaration = undefined
        }
        if (!statementHasContent && !/\s/.test(char)) {
            statementHasContent = true
            statementStart = index
            statementAnnotation = undefined
            statementDescriptionSpan = precedingDescription(index)
            statementDescription = statementDescriptionSpan ? source.slice(statementDescriptionSpan.start + 2, statementDescriptionSpan.end).replace(/^[ \t]+/, '').replace(/\/\//g, ' ') : ''
            statementGroup = group
        }
        if (char === '(' || char === '[') {
            depth++
        } else if (char === ')' || char === ']') {
            depth--
        }
        if (char === ';') lineSemicolons++
        if (char === ';' && depth === 0) {
            const assignment = /^\s*([\p{L}_$][\p{L}\p{N}\p{M}_$]*)\s*=\s*([\s\S]*?)\s*$/u.exec(statement)
            lastParameter = undefined
            lastDeclaration = undefined
            if (assignment) {
                lastDeclaration = { name: assignment[1].normalize('NFC'), group: statementGroup, start: statementStart, end: index + 1, value: parseLiteral(assignment[2]), beforeFirstBrace, description: statementDescriptionSpan }
                declarations.push(lastDeclaration)
            }
            if (assignment) parameters.delete(assignment[1].normalize('NFC'))
            if (assignment && beforeFirstBrace && statementGroup !== 'Hidden') {
                const defaultValue = parseLiteral(assignment[2])
                if (defaultValue !== undefined) {
                    lastParameter = { name: assignment[1].normalize('NFC'), group: statementGroup, description: statementDescription, defaultValue }
                    parameters.set(assignment[1].normalize('NFC'), lastParameter)
                    lastDeclaration!.parameter = lastParameter
                    if (statementAnnotation) {
                        lastDeclaration!.annotation = statementAnnotation
                        lastDeclaration!.declaredChoices = annotate(lastParameter, source.slice(statementAnnotation.start + 2, statementAnnotation.end).trim())
                    }
                }
            }
            statement = ''
            statementHasContent = false
            statementStart = -1
            statementDescription = ''
        } else {
            statement += char
        }
    }
    if (depth !== 0) { complete = false; incompleteReasons.add('unbalancedDelimiters') }
    if (braceDepth !== 0) { complete = false; incompleteReasons.add('unbalancedBraces') }
    if (/^\s*[\p{L}_$][\p{L}\p{N}\p{M}_$]*\s*=/u.test(statement)) { complete = false; incompleteReasons.add('unfinishedAssignment') }
    return { parameters: [...parameters.values()], declarations, complete, incompleteReasons: [...incompleteReasons] }
}

/** Backwards-compatible GUI API; analysis and authoring use the same scanner. */
export function parseCustomizer(source: string): Parameter[] {
    return scanCustomizer(source).parameters
}

export { numericStep } from './CustomizerConstraints'
