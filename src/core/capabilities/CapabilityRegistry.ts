import { Ajv } from 'ajv'
import catalog from './catalog.json'
import { CapabilityError, type CapabilityDefinition, type CapabilityHandler, type CapabilityContext } from './CapabilityTypes'

export const capabilityCatalog: readonly CapabilityDefinition[] = catalog as CapabilityDefinition[]
export class CapabilityRegistry {
    private readonly handlers = new Map<string, CapabilityHandler>()
    private readonly validators = new Map(capabilityCatalog.map((definition) => [definition.id, new Ajv({ strict: true, allErrors: true }).compile(definition.inputSchema)]))
    bind(id: string, handler: CapabilityHandler) {
        if (!this.validators.has(id) || this.handlers.has(id)) throw new Error(`Unknown or duplicate capability: ${id}`)
        this.handlers.set(id, handler)
    }
    assertComplete() {
        for (const definition of capabilityCatalog) if (!this.handlers.has(definition.id)) throw new Error(`Missing capability handler: ${definition.id}`)
        if (new Set(capabilityCatalog.map((d) => d.toolName)).size !== capabilityCatalog.length) throw new Error('Duplicate tool name')
    }
    discover(context: CapabilityContext, offset = 0, limit = 20) {
        return { total: capabilityCatalog.length, capabilities: capabilityCatalog.slice(offset, offset + limit).map((definition) => ({ ...definition, inputSchema: undefined, availability: this.handlers.get(definition.id)?.available(context) ?? { enabled: false, reasonCode: 'NOT_REGISTERED' } })) }
    }
    resolve(id: string, input: unknown, context: CapabilityContext) {
        const validate = this.validators.get(id)
        const handler = this.handlers.get(id)
        if (!validate || !handler) throw new CapabilityError('NOT_FOUND', 'Unknown capability.')
        if (!validate(input)) throw new CapabilityError('INVALID_INPUT', new Ajv().errorsText(validate.errors))
        const availability = handler.available(context)
        if (!availability.enabled) throw new CapabilityError(availability.reasonCode ?? 'UNAVAILABLE', 'Capability is unavailable in the current host/workspace.')
        return handler
    }
}
