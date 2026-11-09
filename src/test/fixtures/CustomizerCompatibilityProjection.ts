import type { Parameter } from '../../core/customizer/CustomizerModel'

/** Fields observed in CLI .param, not a claim about desktop widget interaction. */
export interface NativeCustomizerParameter {
    name: string
    initial: Parameter['defaultValue']
    caption?: string
    group?: string
    min?: number
    max?: number
    step?: number
    options?: Array<{ name: string; value: string | number }>
    maxLength?: number
}

// Omit undefined keys as a JSON fixture does. Preserve array order and scalar types.
const jsonProjection = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function nativeCompatibilityProjection(parameter: NativeCustomizerParameter) {
    return jsonProjection({
        name: parameter.name,
        defaultValue: parameter.initial,
        description: parameter.caption ?? '',
        group: parameter.group ?? 'Parameters',
        range: parameter.max === undefined ? undefined : { min: parameter.min, max: parameter.max },
        step: parameter.step,
        choices: parameter.options?.map(option => ({ label: option.name, value: option.value })),
        maxLength: parameter.maxLength,
    })
}

export function ideCompatibilityProjection(parameter: Parameter & { effectiveRange?: Parameter['range'] }) {
    const range = parameter.effectiveRange ?? parameter.range
    return jsonProjection({
        name: parameter.name,
        defaultValue: parameter.defaultValue,
        description: parameter.description,
        // The tree root is the presentation equivalent of the native Parameters tab.
        group: parameter.group || 'Parameters',
        range: range && { min: range.min, max: range.max },
        // .param always emits a scalar numeric step, but only emits vector steps
        // when a maximum exists. It cannot prove an unbounded vector's GUI step.
        step: !parameter.choices && (typeof parameter.defaultValue === 'number' || (Array.isArray(parameter.defaultValue) && range)) ? range?.step ?? parameter.step ?? 1 : undefined,
        choices: parameter.choices,
        maxLength: parameter.maxLength,
    })
}
