import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import type { SubjectInput, SubjectDigest, PrintProfile, PrintResult } from '../../core/review/types'
interface Request {
    operation: 'digest' | 'view' | 'print' | 'pick'
    subjects: SubjectInput[]
    profile?: PrintProfile
    trusted?: boolean
    pick?: import('../../core/review/geometry').PickRequest
    role?: 'baseline' | 'target'
    origin?: [number, number, number]
}
let path = join(__dirname, 'review-geometry-worker.mjs')
export function configureReviewWorker(value: string) {
    path = value
}
export function reviewWorker(request: Request, signal?: AbortSignal, timeout = 60000): Promise<SubjectDigest[] | PrintResult | { display: Uint8Array; world: Uint8Array } | ReturnType<typeof import('../../core/review/geometry').pickSurface>> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const worker = new Worker(path, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 } })
        let done = false
        const finish = (value?: unknown, error?: Error) => {
            if (done) return
            done = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            void worker.terminate()
            if (error) reject(error)
            else resolve(value as SubjectDigest[])
        }
        const abort = () => finish(undefined, new DOMException('Review geometry cancelled', 'AbortError')),
            timer = setTimeout(() => finish(undefined, new CapabilityError('REVIEW_WORKER_TIMEOUT', 'Review geometry exceeded 60 seconds; no complete result is available.')), timeout)
        signal?.addEventListener('abort', abort, { once: true })
        worker.once('error', (e) => finish(undefined, new CapabilityError('REVIEW_WORKER_FAILED', e.message.slice(0, 2048))))
        worker.once('exit', (code) => {
            if (!done) finish(undefined, new CapabilityError('REVIEW_WORKER_EXIT', `Worker exited ${code}`))
        })
        worker.once('message', (r: { ok: boolean; result: unknown; error: string }) => (r.ok ? finish(r.result) : finish(undefined, new CapabilityError('REVIEW_GEOMETRY_UNRESOLVED', r.error))))
        if (signal?.aborted) abort()
        else worker.postMessage(request)
    })
}
