import { parseCustomizer, numericStep } from '../../../../core/customizer/CustomizerParser'
import type { ScadParameter } from '../../shared/types/ScadParameter'

/** Adapt the IDE's single Customizer parser to the preview UI schema. */
export class ScadParser {
    readonly parameters: ScadParameter[]
    constructor(content: string) {
        this.parameters = parseCustomizer(content).map((parameter): ScadParameter => {
            const metadata = { name: parameter.name, group: parameter.group, description: parameter.description }
            const value = parameter.defaultValue
            if (Array.isArray(value)) {
                return { ...metadata, type: 'vector', value, ...parameter.range, step: numericStep(parameter) }
            }
            if (typeof value === 'number') {
                return { ...metadata, type: 'number', value, ...parameter.range, step: numericStep(parameter), options: parameter.choices }
            }
            if (typeof value === 'boolean') {
                return { ...metadata, type: 'boolean', value }
            }
            return { ...metadata, type: 'string', value, ...(parameter.maxLength !== undefined ? { maxLength: parameter.maxLength } : {}), options: parameter.choices }
        })
    }
}
