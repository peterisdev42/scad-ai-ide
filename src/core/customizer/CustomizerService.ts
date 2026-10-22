import { parseCustomizer, type Parameter, type ParameterValue } from './CustomizerParser'

export function validateValue(parameter: Parameter, value: ParameterValue): string | undefined {
    if (typeof value !== typeof parameter.defaultValue) {
        return 'Value has the wrong type'
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return 'Enter a finite number'
    }
    if (parameter.choices && !parameter.choices.some((choice) => choice.value === value)) {
        return 'Choose a listed value'
    }
    if (parameter.range && typeof value === 'number') {
        const { min, max, step } = parameter.range
        if (value < min || value > max) {
            return `Enter a value between ${min} and ${max}`
        }
        if (step && Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-7) {
            return `Use steps of ${step} from ${min}`
        }
    }
    return undefined
}

export class CustomizerService {
    target?: string
    parameters: Parameter[] = []
    private readonly overrides = new Map<string, Map<string, ParameterValue>>()

    private readonly listeners = new Set<(target: string) => void>()

    onDidChangeValues(listener: (target: string) => void): { dispose(): void } {
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

    replaceOverrides(target: string, values: Record<string, ParameterValue>): void {
        this.overrides.set(target, new Map(Object.entries(values)))
        for (const listener of this.listeners) {
            listener(target)
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

    set(name: string, value: ParameterValue): void {
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
        if (value === parameter.defaultValue) {
            values.delete(name)
        } else {
            values.set(name, value)
        }
        for (const listener of this.listeners) {
            listener(this.target)
        }
    }

    getArguments(): string[] {
        return this.parameters.flatMap((parameter) => {
            const value = this.overrides.get(this.target ?? '')?.get(parameter.name)
            return value === undefined ? [] : ['-D', `${parameter.name}=${JSON.stringify(value)}`]
        })
    }
}
