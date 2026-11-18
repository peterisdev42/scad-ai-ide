import type { SourceExpectation } from '../../core/customizer/CustomizerSourceTypes'
import * as vscode from 'vscode'
import type { ParameterValue } from '../../core/customizer/CustomizerParser'
import { type ToolHandler } from '../contracts/ToolServices'

export const stateHandler: ToolHandler = (_input, _context, { customizer }) => {
    return customizer.snapshot()
}

export const setHandler: ToolHandler = (input, _context, { customizer }) => {
    return customizer.setValues(String(input.target), Number(input.revision), input.values as Record<string, ParameterValue>)
}

export const resetHandler: ToolHandler = (input, _context, { customizer }) => {
    return customizer.reset(String(input.target), Number(input.revision), input.name as string | undefined)
}

export const applyPresetHandler: ToolHandler = (input, ctx, { customizer }) => {
    return customizer.preset(String(input.target), Number(input.revision), 'select', input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
}

export const createPresetHandler: ToolHandler = (input, ctx, { customizer }) => {
    return customizer.preset(String(input.target), Number(input.revision), 'new', input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
}

export const savePresetHandler: ToolHandler = (input, ctx, { customizer }) => {
    return customizer.preset(String(input.target), Number(input.revision), 'save', input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
}

export const deletePresetHandler: ToolHandler = (input, ctx, { customizer }) => {
    return customizer.preset(String(input.target), Number(input.revision), 'delete', input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
}

export const importPresetsHandler: ToolHandler = (input, ctx, { customizer }) => {
    return customizer.preset(String(input.target), Number(input.revision), 'import', input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
}

export const exportPresetsHandler: ToolHandler = (input, ctx, { customizer }) => {
    return customizer.preset(String(input.target), Number(input.revision), 'export', input.name as string | undefined, input.uri ? vscode.Uri.parse(String(input.uri), true) : undefined, ctx)
}

export const sourceAnalyzeHandler: ToolHandler = (input, _context, { customizerSource }) => {
    return customizerSource.analyze(String(input.uri), input)
}

export const sourceApplyHandler: ToolHandler = (input, ctx, { customizerSource }) => {
    return customizerSource.apply(input, ctx)
}

export const sourceValidateHandler: ToolHandler = (input, _context, { customizerSource }) => {
    return customizerSource.validate(String(input.uri), input.expectations as SourceExpectation[] | undefined, input.includeWarnings as boolean | undefined)
}
