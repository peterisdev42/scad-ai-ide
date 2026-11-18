import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import { type ToolHandler } from '../contracts/ToolServices'

export const statusHandler: ToolHandler = (_input, _context, { development }) => {
    return { enabled: development.enabled, reason: development.enabled ? undefined : 'DEVELOPMENT_ONLY' }
}

export const listCachesHandler: ToolHandler = (input, _context, { development }) => {
    return development.listSafe(Number(input.offset ?? 0), Number(input.limit ?? 20))
}

export const inspectCacheHandler: ToolHandler = (input, _context, { development }) => {
    return development.inspectSafe(String(input.id))
}

export const clearCachesHandler: ToolHandler = (input, _context, { development }) => {
    if (Object.keys(input).length !== 1) throw new CapabilityError('INVALID_INPUT', 'Choose exactly one cache ID, scope or all=true.')
    return development.clearSafe(input)
}
