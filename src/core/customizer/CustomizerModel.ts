/** Shared domain types; no VS Code, Agent or browser dependencies. */
export type ParameterValue = string | number | boolean | number[]

export interface NumericRange { min: number; max: number; step?: number }

export interface Parameter {
    name: string
    group: string
    description: string
    defaultValue: ParameterValue
    /** Legacy range and contract expectations retain the written limits. */
    range?: NumericRange
    declaredRange?: NumericRange
    effectiveRange?: NumericRange
    choices?: { label: string; value: string | number }[]
    step?: number
    maxLength?: number
    hint?: string
}

