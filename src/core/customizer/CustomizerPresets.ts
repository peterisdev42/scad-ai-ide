import { parseLiteral, type Parameter, type ParameterValue } from './CustomizerParser'
import { validateValue } from './CustomizerService'

export interface PresetFile {
    fileFormatVersion: string
    parameterSets: Record<string, Record<string, string>>
    [key: string]: unknown
}

export function parsePresetFile(content: string): PresetFile {
    const data: unknown = JSON.parse(content)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected an OpenSCAD parameter file')
    const file = data as PresetFile
    if (file.fileFormatVersion !== undefined && file.fileFormatVersion !== '1') throw new Error('Unsupported parameter file version')
    if (!file.parameterSets || typeof file.parameterSets !== 'object' || Array.isArray(file.parameterSets)) throw new Error('Expected parameterSets in the JSON file')
    for (const [name, values] of Object.entries(file.parameterSets)) {
        if (!name.trim() || !values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some((value) => typeof value !== 'string')) {
            throw new Error(`Invalid parameter set: ${name}`)
        }
    }
    return { ...file, fileFormatVersion: '1' }
}

export function encodePresetValue(value: ParameterValue): string {
    return Array.isArray(value) ? JSON.stringify(value) : String(value)
}

export function decodePresetValue(parameter: Parameter, raw: string): ParameterValue | undefined {
    // Enum entries retain their own types, including mixed number/string menus.
    if (parameter.choices) {
        return parameter.choices.find((choice) => typeof choice.value === 'string' && choice.value === raw)?.value ?? parameter.choices.find((choice) => choice.value === parseLiteral(raw))?.value
    }
    return typeof parameter.defaultValue === 'string' ? raw : parseLiteral(raw)
}

/** Validate a whole set before applying it. Unknown/hidden parameters are preserved in JSON only. */
export function presetOverrides(parameters: Parameter[], values: Record<string, string>): Record<string, ParameterValue> {
    const overrides: [string, ParameterValue][] = []
    for (const parameter of parameters) {
        if (!Object.hasOwn(values, parameter.name)) continue
        const value = decodePresetValue(parameter, values[parameter.name])
        const error = validateValue(parameter, value)
        if (error) throw new Error(`${parameter.name}: ${error}`)
        overrides.push([parameter.name, value!])
    }
    return Object.fromEntries(overrides)
}
