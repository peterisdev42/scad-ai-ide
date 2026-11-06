import { analyzeCustomizerSource } from '../../../../core/customizer/CustomizerSourceAnalyzer'
import { numericStep } from '../../../../core/customizer/CustomizerParser'
import type { ScadParameter } from '../../shared/types/ScadParameter'

/** Adapt the IDE's single Customizer parser to the preview UI schema. */
export class ScadParser {
    readonly parameters: ScadParameter[]
    readonly complete: boolean
    constructor(content: string) {
        const analysis = analyzeCustomizerSource(content, { includeCandidates: false, maxDiagnostics: 200 })
        this.complete = analysis.complete
        this.parameters = analysis.parameters.map((parameter): ScadParameter => {
            const metadata = { name: parameter.name, group: parameter.group, description: parameter.description }
            const value = parameter.defaultValue
            const range = parameter.effectiveRange ?? parameter.range
            if (Array.isArray(value)) {
                return { ...metadata, type: 'vector', value, ...range, step: numericStep(parameter) }
            }
            if (typeof value === 'number') {
                return { ...metadata, type: 'number', value, ...range, step: numericStep(parameter), options: parameter.choices }
            }
            if (typeof value === 'boolean') {
                return { ...metadata, type: 'boolean', value }
            }
            return { ...metadata, type: 'string', value, ...(parameter.maxLength !== undefined ? { maxLength: parameter.maxLength } : {}), options: parameter.choices }
        })
    }
}
