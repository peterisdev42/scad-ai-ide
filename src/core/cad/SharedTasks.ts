/** A caller cancelling releases only its subscription. The last subscriber owns task cancellation. */
export class SharedTasks<T> {
    private tasks = new Map<string, { abort: AbortController; promise: Promise<T>; users: number }>()
    run(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted()
        let entry = this.tasks.get(key)
        if (entry?.abort.signal.aborted) entry = undefined
        if (!entry) {
            const abort = new AbortController()
            const created = { abort, promise: Promise.resolve().then(() => task(abort.signal)), users: 0 }
            entry = created
            this.tasks.set(key, created)
            void created.promise
                .finally(() => {
                    if (this.tasks.get(key) === created) this.tasks.delete(key)
                })
                .catch(() => {})
        }
        const shared = entry
        shared.users++
        return new Promise((resolve, reject) => {
            let done = false
            const finish = (error?: unknown, value?: T) => {
                if (done) return
                done = true
                signal?.removeEventListener('abort', cancel)
                if (--shared.users === 0) shared.abort.abort()
                if (error) reject(error)
                else resolve(value!)
            }
            const cancel = () => finish(new DOMException('Analysis cancelled', 'AbortError'))
            signal?.addEventListener('abort', cancel, { once: true })
            shared.promise.then(
                (v) => finish(undefined, v),
                (e) => finish(e),
            )
            if (signal?.aborted) cancel()
        })
    }
    cancelWhere(predicate: (key: string) => boolean) {
        for (const [key, entry] of this.tasks) if (predicate(key)) entry.abort.abort()
    }
    dispose() {
        for (const entry of this.tasks.values()) entry.abort.abort()
        this.tasks.clear()
    }
}
