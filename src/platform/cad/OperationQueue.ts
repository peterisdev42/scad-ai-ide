import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
/** FIFO admission before materializing large buffers. Cancellation owns its reservation. */
export class OperationQueue {
    private active = 0
    private waiting: Array<{ start(): void; cancel(): void }> = []
    private controllers = new Set<AbortController>()
    private disposed = false
    constructor(private readonly concurrent = 1, private readonly maxQueued = 32) {}
    async run<T>(task: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal): Promise<T> {
        if (this.disposed) throw new CapabilityError('DISPOSED', 'Operation queue disposed.')
        const abort = new AbortController(), signal = caller ? AbortSignal.any([caller, abort.signal]) : abort.signal
        signal.throwIfAborted(); this.controllers.add(abort)
        let acquired = false
        try {
            if (this.active >= this.concurrent) {
                if (this.waiting.length >= this.maxQueued) throw new CapabilityError('BUSY', 'Geometry queue is full.', true)
                await new Promise<void>((resolve, reject) => {
                    const entry = { start: () => { signal.removeEventListener('abort', entry.cancel); resolve() }, cancel: () => { this.waiting = this.waiting.filter(e => e !== entry); reject(new DOMException('Queued operation cancelled', 'AbortError')) } }
                    this.waiting.push(entry); signal.addEventListener('abort', entry.cancel, { once: true })
                })
            } else this.active++
            acquired = true; signal.throwIfAborted()
            return await task(signal)
        } finally {
            this.controllers.delete(abort)
            if (acquired) { const next = this.waiting.shift(); if (next) next.start(); else this.active-- }
        }
    }
    dispose() { this.disposed = true; for (const controller of this.controllers) controller.abort() }
}
