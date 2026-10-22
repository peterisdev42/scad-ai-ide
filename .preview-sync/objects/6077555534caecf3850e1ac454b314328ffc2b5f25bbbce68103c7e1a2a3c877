import { parseCustomizer } from '../../../../core/customizer/CustomizerParser'
import type { ScadParameter } from '../../shared/types/ScadParameter'

/** Adapt the IDE's single Customizer parser to the preview UI schema. */
export class ScadParser {
    readonly parameters: ScadParameter[]
    constructor(content: string) {
        this.parameters = parseCustomizer(content).map((parameter): ScadParameter => {
            const metadata = { name: parameter.name, group: parameter.group, description: parameter.description }
            const value = parameter.defaultValue
            if (typeof value === 'number') {
                return { ...metadata, type: 'number', value, ...parameter.range, options: parameter.choices as { label: string; value: number }[] | undefined }
            }
            if (typeof value === 'boolean') {
                return { ...metadata, type: 'boolean', value }
            }
            return { ...metadata, type: 'string', value, options: parameter.choices as { label: string; value: string }[] | undefined }
        })
    }
}
