import { parsePresetFile } from '../../../../core/customizer/CustomizerPresets'
import type { Parameter } from '../../../../core/customizer/CustomizerModel'
import { validateValue } from '../../../../core/customizer/CustomizerConstraints'
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
    private overrides: Map<string, string | number | boolean | number[]> = new Map()
    private onChange?: (event: { parameters: ScadParameter[]; parameterSets: Record<string, Record<string, string>>; activeSetName: string | undefined; overrides: Record<string, string | number | boolean | number[]> }) => void

    constructor({
        onChange,
    }: {
        onChange?: (event: { parameters: ScadParameter[]; parameterSets: Record<string, Record<string, string>>; activeSetName: string | undefined; overrides: Record<string, string | number | boolean | number[]> }) => void
    } = {}) {
        this.onChange = onChange
    }

    private domainParameter(parameter: ScadParameter): Parameter {
        return {
            name: parameter.name,
            group: parameter.group ?? '',
            description: parameter.description ?? '',
            defaultValue: parameter.value,
            range: (parameter.type === 'number' || parameter.type === 'vector') && parameter.min !== undefined && parameter.max !== undefined ? { min: parameter.min, max: parameter.max, step: parameter.step } : undefined,
            maxLength: parameter.type === 'string' ? parameter.maxLength : undefined,
            choices: parameter.type === 'number' || parameter.type === 'string' ? parameter.options?.map(option => ({ label: option.label ?? String(option.value), value: option.value })) : undefined,
        }
    }
    private valid(name: string, value: ParameterValue): boolean {
        const parameter = this.parameters.get(name)
        return !!parameter && !validateValue(this.domainParameter(parameter), value)
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

    /** Mirrors host preset identity without applying values or changing overrides. */
    public syncPresetState(sets: Record<string, Record<string, string>>, active: string | undefined) {
        this.parameterSets = parsePresetFile(JSON.stringify({ parameterSets: sets })).parameterSets
        this.activeSetName = active
        this.fireChange()
    }

    public getParameterSets(): Record<string, Record<string, string>> {
        return this.parameterSets
    }

    public getActiveSetName(): string | undefined {
        return this.activeSetName
    }

    /**
     * Call this to override a parameter value, or to revert back to the original
     * value for a parameter.
     */
    public replaceOverrides(values: Record<string, string | number | boolean | number[]>, validate = true) {
        this.overrides = new Map(Object.entries(values).filter(([name, value]) => !validate || this.valid(name, value)))
        this.fireChange()
    }

    public updateValue(name: string, value: string | number | boolean | number[] | undefined) {
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

    public getOverrides(): Record<string, string | number | boolean | number[]> {
        return Object.fromEntries(this.overrides)
    }

}
