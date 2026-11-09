import type { Parameter } from './CustomizerModel'

/** The native StringParameter import limit counts UTF-8 bytes, not JS UTF-16. */
export function utf8Length(value: string): number {
    let size = 0
    for (const char of value) {
        const code = char.codePointAt(0)!
        size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    }
    return size
}

/** Pure value validation, usable by the extension host and the webview. */
export function validateValue(parameter: Parameter, value: unknown): string | undefined {
    if (parameter.choices) {
        return parameter.choices.some((choice) => choice.value === value) ? undefined : 'Choose a listed value'
    }
    const vector = Array.isArray(parameter.defaultValue)
    if (vector ? !Array.isArray(value) || value.length !== (parameter.defaultValue as number[]).length : typeof value !== typeof parameter.defaultValue || Array.isArray(value)) {
        return 'Value has the wrong type or vector length'
    }
    const numbers = vector ? Array.from(value as unknown[]) : typeof value === 'number' ? [value] : []
    if (numbers.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
        return 'Enter a finite number'
    }
    if (parameter.maxLength !== undefined && typeof value === 'string' && utf8Length(value) > parameter.maxLength) {
        return `Use at most ${parameter.maxLength} UTF-8 bytes`
    }
    const range = parameter.effectiveRange ?? parameter.range
    if (range) {
        for (const number of numbers as number[]) {
            if (number < range.min || number > range.max) return `Enter a value between ${range.min} and ${range.max}`
        }
    }
    return undefined
}


/** Match the precision of the literal defaults instead of rounding decimal controls to integers. */
export function numericStep(parameter: Parameter): number {
    if (parameter.effectiveRange?.step !== undefined) return parameter.effectiveRange.step
    if (parameter.range?.step !== undefined) return parameter.range.step
    if (parameter.step !== undefined) return parameter.step
    const values = Array.isArray(parameter.defaultValue) ? [...parameter.defaultValue] : [parameter.defaultValue]
    if (parameter.range) values.push(parameter.range.min)
    const decimals = values.reduce<number>((precision, value) => {
        const [fraction, exponent = '0'] = String(value).toLowerCase().split('e')
        return Math.max(precision, (fraction.split('.')[1]?.length ?? 0) - Number(exponent))
    }, 0)
    return 10 ** -Math.min(decimals, 15)
}

/** Pointer interaction lattice, separate from value validation. Native sliders
 * anchor positions at minimum and stop at the last full step below maximum. */
export function snapNumericInteraction(value: number, min: number, max: number, step: number): number {
    const extent = (max - min) / step
    if (![value, min, max, step, extent].every(Number.isFinite) || step <= 0 || min > max) return value
    const last = Math.floor(extent + Number.EPSILON * Math.max(1, Math.abs(extent)))
    const position = Math.min(last, Math.max(0, Math.round((value - min) / step)))
    return Math.min(max, Math.max(min, Number((min + position * step).toPrecision(15))))
}
