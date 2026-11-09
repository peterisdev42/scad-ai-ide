import type { Parameter, ParameterValue } from './CustomizerModel'
import { analyzeCustomizerSource } from './CustomizerSourceAnalyzer'

import { validateValue } from './CustomizerConstraints'
export { validateValue } from './CustomizerConstraints'

export function equalValues(left: ParameterValue, right: ParameterValue): boolean {
    return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, index) => value === right[index]) : left === right
}

export type CustomizerChangeReason = 'values' | 'preset' | 'input' | 'commit'

export class CustomizerService {
    target?: string
    parameters: Parameter[] = []
    analysisStatus = { complete: true, incompleteReasons: [] as string[] }
    private readonly overrides = new Map<string, Map<string, ParameterValue>>()

    private readonly continuousTargets = new Set<string>()
    private readonly previewListeners = new Set<(target: string) => void>()

    canPreviewContinuously(target = this.target): boolean {
        return !!target && this.continuousTargets.has(target)
    }
    setContinuousPreview(target: string, enabled: boolean): void {
        if (this.continuousTargets.has(target) === enabled) return
        if (enabled) this.continuousTargets.add(target)
        else this.continuousTargets.delete(target)
        for (const listener of this.previewListeners) listener(target)
    }
    onDidChangePreviewCapability(listener: (target: string) => void): { dispose(): void } {
        this.previewListeners.add(listener)
        return {
            dispose: () => {
                this.previewListeners.delete(listener)
            },
        }
    }

    private readonly listeners = new Set<(target: string, reason: CustomizerChangeReason) => void>()

    onDidChangeValues(listener: (target: string, reason: CustomizerChangeReason) => void): { dispose(): void } {
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

    replaceOverrides(target: string, values: Record<string, ParameterValue>, reason: CustomizerChangeReason = 'values'): void {
        this.overrides.set(target, new Map(Object.entries(values)))
        for (const listener of this.listeners) {
            listener(target, reason)
        }
    }

    load(target: string, source: string): void {
        this.target = target
        const analysis = analyzeCustomizerSource(source, { includeCandidates: false, maxDiagnostics: 200 })
        this.analysisStatus = { complete: analysis.complete, incompleteReasons: analysis.incompleteReasons }
        this.parameters = analysis.parameters.map(({ widget: _widget, declarationRange: _declaration, annotationRange: _annotation, descriptionRange: _description, ...parameter }) => parameter)
        // Temporary incomplete buffers must not erase stored per-file overrides.
        if (!analysis.complete) return
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
        this.analysisStatus = { complete: true, incompleteReasons: [] }
    }

    value(parameter: Parameter): ParameterValue {
        return this.overrides.get(this.target ?? '')?.get(parameter.name) ?? parameter.defaultValue
    }

    set(name: string, value: ParameterValue, reason: CustomizerChangeReason = 'values'): void {
        this.setMany({ [name]: value }, reason)
    }

    /** Validate the entire batch before touching overrides; GUI single writes use this same path. */
    setMany(input: Record<string, ParameterValue>, reason: CustomizerChangeReason = 'values'): void {
        if (!this.target) throw new Error('Parameter is no longer available')
        if (!this.analysisStatus.complete) throw new Error('Source analysis is incomplete; finish the source edit before changing parameter values')
        const validated = Object.entries(input).map(([name, value]) => {
            const parameter = this.parameters.find((item) => item.name === name)
            if (!parameter) throw new Error(`Parameter is no longer available: ${name}`)
            const error = validateValue(parameter, value)
            if (error) throw new Error(`${name}: ${error}`)
            return { name, value, parameter }
        })
        const values = new Map(this.overrides.get(this.target))
        for (const { name, value, parameter } of validated) {
            if (equalValues(value, parameter.defaultValue)) values.delete(name)
            else values.set(name, value)
        }
        this.overrides.set(this.target, values)
        for (const listener of this.listeners) listener(this.target, reason)
    }

    reset(name?: string, reason: CustomizerChangeReason = 'values'): void {
        if (!this.target) {
            return
        }
        if (name === undefined) {
            this.overrides.delete(this.target)
        } else {
            this.overrides.get(this.target)?.delete(name)
        }
        for (const listener of this.listeners) {
            listener(this.target, reason)
        }
    }

    getArguments(): string[] {
        return this.parameters.flatMap((parameter) => {
            const value = this.overrides.get(this.target ?? '')?.get(parameter.name)
            return value === undefined ? [] : ['-D', `${parameter.name}=${JSON.stringify(value)}`]
        })
    }
}
