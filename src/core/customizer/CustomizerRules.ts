import { parseCustomizerAnnotation, splitOutsideStrings } from './CustomizerAnnotation'

export const CUSTOMIZER_REFERENCE = 'bcf45a22caa954ca56ca287994cb6dbc368c67b2'
const rule = (code: string, title: string, category: 'annotation' | 'constraint') => ({ code: `CUSTOMIZER_${code}`, title, category, severity: 'warning' as const })

/** Stable rule identity and fix policy. Legacy Diagnostic.code remains unchanged. */
export const customizerRules = {
    'CUST-ANN-01': rule('MALFORMED_HINT', 'Close the incomplete Customizer hint', 'annotation'),
    'CUST-ANN-02': rule('MALFORMED_HINT', 'Remove the invalid numeric step', 'constraint'),
    'CUST-RANGE-01': rule('INVALID_RANGE', 'Review the reversed range bounds', 'constraint'),
    'CUST-RANGE-02': rule('INVALID_RANGE', 'Remove the invalid explicit slider step', 'constraint'),
    'CUST-ANN-03': rule('INVALID_CHOICES', 'Remove empty Customizer options', 'annotation'),
    'CUST-TEXT-01': rule('MALFORMED_HINT', 'Review the text length hint', 'constraint'),
    'CUST-TEXT-02': rule('DEFAULT_OUT_OF_RANGE', 'Review the default text and byte limit', 'constraint'),
    'CUST-RANGE-03': rule('DEFAULT_OUT_OF_RANGE', 'Review the default and declared bounds', 'constraint'),
} as const
export type CustomizerRuleId = keyof typeof customizerRules

/** Only a uniquely determined local replacement is returned. No guessed values,
 * bound swaps, default changes, text truncation or replacement of ordinary prose. */
export function safeHintReplacement(ruleId: CustomizerRuleId, hint: string): string | undefined {
    const annotation = parseCustomizerAnnotation(hint)
    if (ruleId === 'CUST-ANN-02' && annotation.kind === 'number' && annotation.value <= 0) return ''
    if (ruleId === 'CUST-RANGE-02' && annotation.kind === 'range' && annotation.min <= annotation.max && annotation.step !== undefined && annotation.step <= 0) {
        const parts = splitOutsideStrings(hint.slice(1, -1), ':')
        return `[${parts[0]}:${parts[2]}]`
    }
    if (ruleId === 'CUST-ANN-01' && /^\[\s*[\p{L}\p{N}_+.,:\s-]+$/u.test(hint) && !hint.includes(']')) {
        // Space inside an unquoted value/label could be prose; numeric lists/ranges
        // are unambiguous, simple word lists must have no internal word spaces.
        const body = hint.slice(1).trim()
        const numeric = /^[+-]?(?:\d|\.\d)[+\d.eE,:\s-]*$/.test(body)
        const words = /^[\p{L}_][\p{L}\p{N}_-]*(?:\s*,\s*[\p{L}_][\p{L}\p{N}_-]*)+$/u.test(body)
        const closed = parseCustomizerAnnotation(hint + ']')
        if ((numeric || words) && (closed.kind === 'range' || closed.kind === 'choices')) return hint + ']'
    }
    if (ruleId === 'CUST-ANN-03' && /^\[[\p{L}\p{N}_+.,\s-]+\]$/u.test(hint)) {
        const entries = splitOutsideStrings(hint.slice(1, -1), ',')
        if (entries.every(entry => !entry || /^[\p{L}\p{N}_+.-]+$/u.test(entry))) {
            const replacement = '[' + entries.filter(Boolean).join(',') + ']'
            // A single numeric item denotes a maximum, so do not turn a broken
            // dropdown into a slider by removing its commas.
            if (parseCustomizerAnnotation(replacement).kind === 'choices') return replacement
        }
    }
    return undefined
}

export function hasUnclosedHintIntent(hint: string): boolean {
    if (!hint.startsWith('[')) return false
    if (/^\[\s*"/.test(hint)) return true
    if (/^\[\s*[+-]?(?:\d|\.\d)[+\d.eE,:\s-]*$/.test(hint) && /\d/.test(hint)) return true
    return safeHintReplacement('CUST-ANN-01', hint) !== undefined
}
