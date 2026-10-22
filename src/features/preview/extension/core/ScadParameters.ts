import { validateValue } from '../../../../core/customizer/CustomizerService'
import type { ParameterValue } from '../../../../core/customizer/CustomizerParser'
import { ScadParameter } from '../../shared/types/ScadParameter'

/**
 * Keeps a reference to the parameters of a SCAD document, as well as a set of
 * optional overrides for those parameters.
 */
export class ScadParameters {
    private parameters: Map<string, ScadParameter> = new Map()
    private parameterSets: Record<string, Record<string, string>> = {}
    private activeSetName: string | undefined = undefined
    private overrides: Map<string, string | number | boolean> = new Map()
    private onChange?: (event: { parameters: ScadParameter[]; parameterSets: Record<string, Record<string, string>>; activeSetName: string | undefined; overrides: Record<string, string | number | boolean> }) => void

    constructor({
        onChange,
    }: {
        onChange?: (event: { parameters: ScadParameter[]; parameterSets: Record<string, Record<string, string>>; activeSetName: string | undefined; overrides: Record<string, string | number | boolean> }) => void
    } = {}) {
        this.onChange = onChange
    }

    private valid(name: string, value: ParameterValue): boolean {
        const parameter = this.parameters.get(name)
        if (!parameter) {
            return false
        }
        return !validateValue(
            {
                name,
                group: parameter.group ?? '',
                description: parameter.description ?? '',
                defaultValue: parameter.value,
                range: parameter.type === 'number' && parameter.min !== undefined && parameter.max !== undefined ? { min: parameter.min, max: parameter.max, step: parameter.step } : undefined,
                choices: parameter.type !== 'boolean' ? parameter.options?.map((option) => ({ label: option.label ?? String(option.value), value: option.value })) : undefined,
            },
            value,
        )
    }

    private fireChange() {
        this.onChange?.({
            parameters: this.getParameters(),
            parameterSets: this.parameterSets,
            activeSetName: this.activeSetName,
            overrides: this.getOverrides(),
        })
    }

    /**
     * Call this to update the original parameter definitions, for example after
     * the SCAD file has been changed.
     *
     * Re-evaluates overrides to drop any that no longer exist in the new definitions.
     */
    public updateDefinitions(newParameters: ScadParameter[]) {
        this.parameters.clear()
        newParameters.forEach((param) => {
            this.parameters.set(param.name, param)
        })

        // Remove overrides for parameters that no longer exist
        for (const [name, value] of this.overrides) {
            if (!this.valid(name, value)) {
                this.overrides.delete(name)
            }
        }

        this.fireChange()
    }

    public updateParameterSets(sets: Record<string, Record<string, string>>) {
        this.parameterSets = Object.fromEntries(
            Object.entries(sets)
                .filter(([, values]) => values && typeof values === 'object')
                .map(([name, values]) => [name, Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string'))]),
        )
        this.fireChange()
    }

    public getParameterSets(): Record<string, Record<string, string>> {
        return this.parameterSets
    }

    public setActiveSet(name: string | undefined) {
        this.activeSetName = name
        this.overrides.clear()

        if (name && this.parameterSets[name]) {
            const setValues = this.parameterSets[name]
            for (const param of this.parameters.values()) {
                if (param.name in setValues) {
                    const rawStr = setValues[param.name]
                    if (typeof param.value === 'number') {
                        const number = Number(rawStr)
                        if (Number.isFinite(number)) {
                            this.overrides.set(param.name, number)
                        }
                    } else if (typeof param.value === 'boolean') {
                        this.overrides.set(param.name, rawStr === 'true')
                    } else {
                        this.overrides.set(param.name, rawStr)
                    }
                }
            }
        }

        for (const [name, value] of this.overrides) {
            if (!this.valid(name, value)) {
                this.overrides.delete(name)
            }
        }
        this.fireChange()
    }

    public getActiveSetName(): string | undefined {
        return this.activeSetName
    }

    /**
     * Call this to override a parameter value, or to revert back to the original
     * value for a parameter.
     */
    public replaceOverrides(values: Record<string, string | number | boolean>) {
        this.overrides = new Map(Object.entries(values).filter(([name, value]) => this.valid(name, value)))
        this.fireChange()
    }

    public updateValue(name: string, value: string | number | boolean | undefined) {
        const parameter = this.parameters.get(name)
        if (!parameter) {
            return
        }
        if (value !== undefined && !this.valid(name, value)) {
            return
        }
        if (value === null || value === undefined) {
            this.overrides.delete(name)
        } else {
            this.overrides.set(name, value)
        }

        this.fireChange()
    }

    public getParameters(): ScadParameter[] {
        return Array.from(this.parameters.values())
    }

    public getOverrides(): Record<string, string | number | boolean> {
        return Object.fromEntries(this.overrides)
    }

    /**
     * Returns a merged record of the active parameter values,
     * combining default values exclusively with the flat active overrides map.
     */
    public getActiveValues(): Record<string, string | number | boolean> {
        const active: Record<string, string | number | boolean> = {}

        for (const param of this.parameters.values()) {
            if (this.overrides.has(param.name)) {
                active[param.name] = this.overrides.get(param.name)!
            } else {
                active[param.name] = param.value
            }
        }

        return active
    }

    /**
     * Calculates a partial record of active values to save.
     * In the flat model, this is simply a direct string serialization of all explicit edits in the overrides bucket,
     * protecting against future SCAD default value mutations.
     */
    public calculateActiveSetPartial(): Record<string, string> {
        const partial: Record<string, string> = {}
        for (const [name, value] of this.overrides) {
            partial[name] = value.toString()
        }
        return partial
    }
}
