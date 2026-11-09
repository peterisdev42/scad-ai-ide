import { CapabilityError } from '../capabilities/CapabilityTypes'
import type { Parameter, ParameterValue } from './CustomizerModel'
import { validateValue, utf8Length } from './CustomizerConstraints'
import { sourceCoordinates } from './CustomizerSourceAnalyzer'
import type { SourceRange } from './CustomizerSourceTypes'

export interface PresetFile {
    fileFormatVersion?: unknown
    parameterSets: Record<string, Record<string, string>>
    [key: string]: unknown
}
export interface PresetIssue {
    ruleId: 'PRESET-001' | 'PRESET-002' | 'PRESET-003' | 'PRESET-004' | 'PRESET-005' | 'PRESET-006' | 'PRESET-007'
    code: string
    severity: 'error' | 'warning' | 'information'
    message: string
    path: string[]
    range?: SourceRange
    suggestedFix: string
}

export function presetVersionCompatible(file: PresetFile): boolean {
    return file.fileFormatVersion === undefined || file.fileFormatVersion === '1'
}
export function assertPresetCompatible(file: PresetFile): void {
    if (!presetVersionCompatible(file)) throw new CapabilityError('PRESET_UNVERIFIED_VERSION', 'This parameter-file version has not been verified. Read-only analysis is available; applying or writing it is disabled.')
}

function parseStructure(content: string): PresetFile {
    let data: unknown
    try { data = JSON.parse(content) } catch (error) { throw new CapabilityError('PRESET_INVALID_JSON', (error as Error).message) }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CapabilityError('PRESET_INVALID_STRUCTURE', 'Expected an OpenSCAD parameter file object')
    const file = data as PresetFile
    if (!file.parameterSets || typeof file.parameterSets !== 'object' || Array.isArray(file.parameterSets)) throw new CapabilityError('PRESET_INVALID_STRUCTURE', 'Expected parameterSets in the JSON file')
    for (const [name, values] of Object.entries(file.parameterSets)) {
        if (!name.trim() || !values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) throw new CapabilityError('PRESET_INVALID_SET', `Invalid parameter set: ${name}. Set members must be encoded strings.`)
    }
    // Preserve the original version, missing fields and all metadata. Reading an
    // unknown version is distinct from proving it safe to apply or overwrite.
    return file
}
export function parsePresetFile(content: string): PresetFile { return parseStructure(content) }

export function encodePresetValue(value: ParameterValue): string {
    return Array.isArray(value) ? JSON.stringify(value) : String(value)
}

function presetNumber(raw: string): number | undefined {
    const text = raw.trim()
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(text)) return undefined
    const value = Number(text)
    return Number.isFinite(value) ? value : undefined
}
export function decodePresetValue(parameter: Parameter, raw: string): ParameterValue | undefined {
    if (typeof raw !== 'string') return undefined
    const number = presetNumber(raw)
    if (parameter.choices) {
        // Native import visits options in order, comparing both its numeric and
        // verbatim string interpretation. A string-first search changes [1,"1"].
        return parameter.choices.find(choice => typeof choice.value === 'number' ? choice.value === number : choice.value === raw)?.value
    }
    if (typeof parameter.defaultValue === 'string') return raw
    if (typeof parameter.defaultValue === 'number') return number
    if (typeof parameter.defaultValue === 'boolean') {
        const text = raw.trim()
        return text === 'true' || text === '1' ? true : text === 'false' || text === '0' ? false : undefined
    }
    const match = /^\s*\[([\s\S]*)\]\s*$/.exec(raw)
    if (!match) return undefined
    const vector = match[1].split(',').map(presetNumber)
    return vector.every(value => value !== undefined) ? vector as number[] : undefined
}

/** Validate everything before returning a replacement bucket. Native key lookup
 * uses NFC; the original JSON object/keys are left intact for lossless writes. */
export function presetOverrides(parameters: Parameter[], values: Record<string, string>): Record<string, ParameterValue> {
    const normalized = new Map(Object.entries(values).map(([name, value]) => [name.normalize('NFC'), value]))
    const overrides: [string, ParameterValue][] = []
    for (const parameter of parameters) {
        if (!normalized.has(parameter.name)) continue
        const value = decodePresetValue(parameter, normalized.get(parameter.name)!)
        const error = validateValue(parameter, value)
        if (error) throw new CapabilityError(parameter.choices ? 'PRESET_OPTION_NOT_PRESENT' : 'PRESET_INVALID_VALUE', `${parameter.name}: ${error}`)
        overrides.push([parameter.name, value!])
    }
    return Object.fromEntries(overrides)
}

/** Read-only validation for explicitly selected/bound files. No global JSON scan,
 * cleanup, conversion, default clamping or string truncation is performed. */
export function analyzePresetFile(content: string, parameters: Parameter[] = [], reviewUnknown = false) {
    let file: PresetFile
    const diagnostics: PresetIssue[] = []
    try { file = parseStructure(content) } catch (error) {
        const failure = error as CapabilityError
        const invalidJSON = failure.code === 'PRESET_INVALID_JSON'
        const position = /position (\d+)/i.exec(failure.message)?.[1]
        const offset = position ? Number(position) : content.length
        const range = invalidJSON && position !== undefined ? sourceCoordinates(content)({ start: Math.min(offset, content.length), end: Math.min(offset + 1, content.length) }) : undefined
        diagnostics.push({ ruleId: invalidJSON ? 'PRESET-001' : failure.code === 'PRESET_INVALID_SET' ? 'PRESET-003' : 'PRESET-002', code: invalidJSON ? 'INVALID_JSON' : failure.code === 'PRESET_INVALID_SET' ? 'INVALID_SET' : 'INVALID_STRUCTURE', severity: 'error', message: failure.message, path: [], range, suggestedFix: 'Use an object with parameterSets containing named objects of string-encoded values. Preserve the original values while repairing the JSON.' })
        return { diagnostics, complete: true, omitted: 0, compatible: false, readOnly: true }
    }
    if (!presetVersionCompatible(file)) diagnostics.push({ ruleId: 'PRESET-007', code: 'VERSION_COMPAT', severity: 'information', message: `Unverified fileFormatVersion ${JSON.stringify(file.fileFormatVersion).slice(0, 128)}. Read-only analysis is available; applying and writing are disabled.`, path: ['fileFormatVersion'], suggestedFix: 'Verify compatibility for this version before applying or overwriting it. Do not rewrite its version marker to bypass this check.' })
    else if (file.fileFormatVersion === undefined) diagnostics.push({ ruleId: 'PRESET-007', code: 'VERSION_COMPAT', severity: 'information', message: 'No fileFormatVersion is present; the pinned reader accepts this structure.', path: ['fileFormatVersion'], suggestedFix: 'Preserve this file; new files use the official string version "1".' })
    const schema = new Map(parameters.map(parameter => [parameter.name, parameter]))
    for (const [set, values] of Object.entries(file.parameterSets)) {
        for (const [name, raw] of Object.entries(values)) {
            const parameter = schema.get(name.normalize('NFC'))
            if (!parameter) {
                if (reviewUnknown) diagnostics.push({ ruleId: 'PRESET-005', code: 'UNKNOWN_PARAMETER', severity: 'information', message: `${set}.${name} is not present in this model.`, path: ['parameterSets', set, name], suggestedFix: 'Keep historical or other-model values; do not automatically remove them.' })
                continue
            }
            const value = decodePresetValue(parameter, raw)
            const error = validateValue(parameter, value)
            if (error) diagnostics.push({ ruleId: parameter.choices ? 'PRESET-006' : 'PRESET-004', code: parameter.choices ? 'OPTION_NOT_PRESENT' : 'INVALID_VALUE', severity: 'warning', message: `${set}.${name}: ${error}`, path: ['parameterSets', set, name], suggestedFix: parameter.choices ? 'Choose a value from the effective option list; keep the original JSON until the choice is explicit.' : 'Provide a value compatible with this model. The IDE rejects loss instead of emulating native truncation or clamping.' })
        }
    }
    let bytes = 0
    const bounded = diagnostics.filter(issue => {
        const size = utf8Length(JSON.stringify(issue))
        if (size > 8192 || bytes + size > 64512) return false
        bytes += size
        return true
    }).slice(0, 100)
    return { file, diagnostics: bounded, complete: bounded.length === diagnostics.length, omitted: diagnostics.length - bounded.length, compatible: presetVersionCompatible(file), readOnly: !presetVersionCompatible(file) }
}
