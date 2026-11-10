import type { CustomizerRuleId } from './CustomizerRules'
import type { Parameter, ParameterValue } from './CustomizerParser'

export type CustomizerWidget = 'slider' | 'spinbox' | 'dropdown' | 'checkbox' | 'textbox' | 'vector'
export interface SourceRange { start: { line: number; character: number }; end: { line: number; character: number } }
export interface SourceDocumentIdentity { uri: string; version: number; sha256: string }
export interface CustomizerDiagnostic {
    ruleId: CustomizerRuleId
    evidence: { kind: 'explicit-effective-hint' | 'superseded-parameter'; category: 'annotation' | 'constraint' | 'visibility'; referenceOpenSCADCommit: string }
    fix: { id: CustomizerRuleId; safety: 'safe' | 'review'; title: string }
    code: string
    severity: 'error' | 'warning' | 'information' | 'hint'
    message: string
    range: SourceRange
    parameter?: string
    relatedInformation?: Array<{ range: SourceRange; message: string }>
    suggestedFix?: string
}
export interface CustomizerSourceParameter extends Parameter {
    widget: CustomizerWidget
    declarationRange: SourceRange
    annotationRange?: SourceRange
    descriptionRange?: SourceRange
}
export interface CustomizerSourceAnalysis {
    parameters: CustomizerSourceParameter[]
    candidates: Array<{ name: string; range: SourceRange; reason: string; confidence: 'certain' | 'possible' }>
    diagnostics: CustomizerDiagnostic[]
    complete: boolean
    incompleteReasons: string[]
    omitted: { parameters: number; diagnostics: number; candidates: number }
}
export interface SourceExpectation {
    name: string
    widget?: CustomizerWidget
    type?: 'number' | 'string' | 'boolean' | 'vector'
    group?: string
    defaultValue?: ParameterValue
    range?: Parameter['range']
    choices?: Array<{ value: string | number; label?: string }>
    step?: number
    maxLength?: number
    description?: string
    requireDescription?: boolean
    visible?: boolean
}
export interface SourceEditIntent extends SourceExpectation {
    kind: 'annotateExisting' | 'insertLiteralParameter' | 'changeWidget' | 'moveGroup' | 'hideParameter'
}
export interface SourceTextEdit { start: number; end: number; text: string }
