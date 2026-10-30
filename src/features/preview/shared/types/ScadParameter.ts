interface ParameterMetadata {
    name: string
    description?: string
    group?: string
    hint?: string
}

export interface ParameterOption<T> {
    label?: string
    value: T
}

export interface NumericParameter extends ParameterMetadata {
    type: 'number'
    value: number
    min?: number
    max?: number
    step?: number
    options?: ParameterOption<string | number>[]
}

export interface BooleanParameter extends ParameterMetadata {
    type: 'boolean'
    value: boolean
}

export interface StringParameter extends ParameterMetadata {
    type: 'string'
    value: string
    options?: ParameterOption<string | number>[]
    maxLength?: number
}

export interface VectorParameter extends ParameterMetadata {
    type: 'vector'
    value: number[]
    min?: number
    max?: number
    step?: number
}

export type ScadParameter = NumericParameter | BooleanParameter | StringParameter | VectorParameter
