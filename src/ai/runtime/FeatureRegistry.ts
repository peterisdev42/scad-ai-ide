import { Ajv } from 'ajv'
import type { FeatureCatalog, NormalizedTool } from '../contracts/Feature'
import generated from '../generated/feature-catalog.generated.json'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'

function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }
    return value
}

export const featureCatalog = freeze(generated as FeatureCatalog)
export const isTool = (feature: FeatureCatalog['features'][number]): feature is NormalizedTool => feature.kind === 'tool'
export const toolFeatures = featureCatalog.features.filter(isTool)

export class FeatureRegistry {
    private readonly features: ReadonlyMap<string, FeatureCatalog['features'][number]>
    private readonly tools: ReadonlyMap<string, NormalizedTool>
    private readonly ajv = new Ajv({ strict: true, allErrors: true })
    private readonly validators: ReadonlyMap<string, ReturnType<Ajv['compile']>>

    constructor(readonly catalog: FeatureCatalog) {
        this.features = new Map(catalog.features.map((feature) => [feature.id, feature]))
        this.tools = new Map(catalog.features.filter(isTool).map((feature) => [feature.tool.capabilityId, feature]))
        this.validators = new Map([...this.tools].map(([id, feature]) => [id, this.ajv.compile(feature.tool.inputSchema)]))
    }

    feature(id: string) {
        return this.features.get(id)
    }
    tool(id: string) {
        return this.tools.get(id)
    }

    validate(id: string, input: unknown): asserts input is Record<string, unknown> {
        const validate = this.validators.get(id)
        if (!validate) throw new CapabilityError('NOT_FOUND', 'Unknown capability.')
        if (!validate(input)) throw new CapabilityError('INVALID_INPUT', this.ajv.errorsText(validate.errors))
    }
}
