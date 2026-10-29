export type NotificationSeverity = 'error' | 'warning' | 'info'

export interface Notification {
    /** Stable problem identity shared by all producers. */
    id: string
    scope?: string
    severity: NotificationSeverity
    message: string
    /** Full error detail when the displayed message is only a summary. */
    fingerprint?: string
    policy?: 'until-resolved' | 'cooldown'
    actions?: { label: string; run: () => unknown | PromiseLike<unknown> }[]
}

export type NotificationPresenter = (notice: Notification) => PromiseLike<string | undefined>

interface Entry {
    id: string
    scope?: string
    expires: number
    pending: Promise<void>
}

/** Aggregates problems independently of the UI and of the feature reporting them. */
export class NotificationCenter {
    private readonly entries = new Map<string, Entry>()
    private disposed = false

    constructor(
        private readonly present: NotificationPresenter,
        private readonly onError: (error: unknown) => void,
        private readonly now = Date.now,
        private readonly cooldownMs = 10_000,
    ) {}

    notify(notice: Notification): Promise<void> {
        if (this.disposed) return Promise.resolve()
        const now = this.now()
        for (const [key, entry] of this.entries) {
            if (entry.expires <= now) this.entries.delete(key)
        }
        const persistent = notice.policy === 'until-resolved'
        const key = JSON.stringify([notice.id, notice.scope, persistent ? null : (notice.fingerprint ?? notice.message)])
        const existing = this.entries.get(key)
        if (existing) return existing.pending

        const entry: Entry = { id: notice.id, scope: notice.scope, expires: Infinity, pending: Promise.resolve() }
        this.entries.set(key, entry)
        // Reserve the key before invoking the UI so concurrent producers share one result.
        entry.pending = Promise.resolve()
            .then(async () => {
                if (this.entries.get(key) !== entry) return
                const choice = await this.present(notice)
                if (this.entries.get(key) !== entry) return
                const action = notice.actions?.find((action) => action.label === choice)
                await action?.run()
            })
            .catch((error) => {
                if (this.entries.get(key) === entry) this.entries.delete(key)
                this.onError(error)
            })
            .finally(() => {
                if (!persistent) entry.expires = this.now() + this.cooldownMs
            })
        return entry.pending
    }

    resolve(id: string, scope?: string): void {
        for (const [key, entry] of this.entries) {
            if (entry.id === id && entry.scope === scope) this.entries.delete(key)
        }
    }

    reset(): void {
        this.entries.clear()
        this.disposed = false
    }

    dispose(): void {
        this.entries.clear()
        this.disposed = true
    }
}
