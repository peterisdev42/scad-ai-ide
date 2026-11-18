import { type ToolHandler } from '../contracts/ToolServices'

export const discoverHandler: ToolHandler = (input, ctx, { policy }) => {
    return policy.discover(ctx, Number(input.offset ?? 0), Number(input.limit ?? 20))
}

export const statusHandler: ToolHandler = (input, _context, { operations }) => {
    return operations.status(input.id as string | undefined, Number(input.offset ?? 0), Number(input.limit ?? 20))
}

export const cancelHandler: ToolHandler = (input, _context, { runtime, libraries, operations }) => {
    if (input.domain) {
        const requested = input.domain === 'runtime' ? runtime.cancel() : libraries.cancel()
        return { domain: input.domain, cancellationRequested: requested, status: requested ? 'cancellationRequested' : 'noCancellableTask', message: 'Cancellation is cooperative. Read domain state until the operation finishes; critical transactions may complete.' }
    }
    return operations.cancel(String(input.id))
}
