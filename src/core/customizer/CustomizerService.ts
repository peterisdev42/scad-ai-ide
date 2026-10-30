import { parseCustomizer, type Parameter, type ParameterValue } from './CustomizerParser'

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
    if (parameter.maxLength !== undefined && typeof value === 'string' && value.length > parameter.maxLength) {
        return `Use at most ${parameter.maxLength} characters`
    }
    if (parameter.range) {
        const { min, max, step } = parameter.range
        for (const number of numbers as number[]) {
            if (number < min || number > max) {
                return `Enter a value between ${min} and ${max}`
            }
            if (step && Math.abs((number - min) / step - Math.round((number - min) / step)) > 1e-7) {
                return `Use steps of ${step} from ${min}`
            }
        }
    }
    return undefined
}

export function equalValues(left: ParameterValue, right: ParameterValue): boolean {
    return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, index) => value === right[index]) : left === right
}

export type CustomizerChangeReason = 'values' | 'preset' | 'input' | 'commit'

export class CustomizerService {
    target?: string
    parameters: Parameter[] = []
    private readonly overrides = new Map<string, Map<string, ParameterValue>>()

    private readonly continuousTargets = new Set<string>()
    private readonly previewListeners = new Set<(target: string) => void>()

    canPreviewContinuously(target = this.target): boolean {
        return !!target && this.continuousTargets.has(target)
    }
    setContinuousPreview(target: string, enabled: boolean): void {
        if (this.continuousTargets.has(target) === enabled) return
        if (enabled) this.continuousTargets.add(target)
        else this.continuousTargets.delete(target)
        for (const listener of this.previewListeners) listener(target)
    }
    onDidChangePreviewCapability(listener: (target: string) => void): { dispose(): void } {
        this.previewListeners.add(listener)
        return {
            dispose: () => {
                this.previewListeners.delete(listener)
            },
        }
    }

    private readonly listeners = new Set<(target: string, reason: CustomizerChangeReason) => void>()

    onDidChangeValues(listener: (target: string, reason: CustomizerChangeReason) => void): { dispose(): void } {
        this.listeners.add(listener)
        return {
            dispose: () => {
                this.listeners.delete(listener)
            },
        }
    }

    getOverrides(target: string): Record<string, ParameterValue> {
        return Object.fromEntries(this.overrides.get(target) ?? [])
    }

    replaceOverrides(target: string, values: Record<string, ParameterValue>, reason: CustomizerChangeReason = 'values'): void {
        this.overrides.set(target, new Map(Object.entries(values)))
        for (const listener of this.listeners) {
            listener(target, reason)
        }
    }

    load(target: string, source: string): void {
        this.target = target
        this.parameters = parseCustomizer(source)
        const values = this.overrides.get(target)
        for (const [name, value] of values ?? []) {
            const parameter = this.parameters.find((item) => item.name === name)
            if (!parameter || validateValue(parameter, value)) {
                values!.delete(name)
            }
        }
    }

    clear(): void {
        this.target = undefined
        this.parameters = []
    }

    value(parameter: Parameter): ParameterValue {
        return this.overrides.get(this.target ?? '')?.get(parameter.name) ?? parameter.defaultValue
    }

    set(name: string, value: ParameterValue, reason: CustomizerChangeReason = 'values'): void {
        const parameter = this.parameters.find((item) => item.name === name)
        if (!this.target || !parameter) {
            throw new Error('Parameter is no longer available')
        }
        const error = validateValue(parameter, value)
        if (error) {
            throw new Error(error)
        }
        let values = this.overrides.get(this.target)
        if (!values) {
            values = new Map()
            this.overrides.set(this.target, values)
        }
        if (equalValues(value, parameter.defaultValue)) {
            values.delete(name)
        } else {
            values.set(name, value)
        }
        for (const listener of this.listeners) {
            listener(this.target, reason)
        }
    }

    reset(name?: string, reason: CustomizerChangeReason = 'values'): void {
        if (!this.target) {
            return
        }
        if (name === undefined) {
            this.overrides.delete(this.target)
        } else {
            this.overrides.get(this.target)?.delete(name)
        }
        for (const listener of this.listeners) {
            listener(this.target, reason)
        }
    }

    getArguments(): string[] {
        return this.parameters.flatMap((parameter) => {
            const value = this.overrides.get(this.target ?? '')?.get(parameter.name)
            return value === undefined ? [] : ['-D', `${parameter.name}=${JSON.stringify(value)}`]
        })
    }
}
