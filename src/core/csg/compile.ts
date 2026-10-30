import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { CsgScene } from './types'

let workerPath = join(__dirname, 'csg-worker.mjs')
export function configureCsgWorker(path: string) {
    workerPath = path
}

/** Each job owns its worker, so cancellation can stop synchronous WASM work immediately. */
export function compileCsg(source: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath)
        let settled = false
        const finish = (error?: Error, scene?: CsgScene) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            void worker.terminate()
            if (error) reject(error)
            else resolve(Buffer.from(JSON.stringify(scene)))
        }
        const abort = () => finish(new Error('CSG preview cancelled.'))
        const timer = setTimeout(() => finish(new Error('CSG evaluation timed out after 30 seconds.')), 30000)
        signal?.addEventListener('abort', abort, { once: true })
        worker.once('error', (error) => finish(error))
        worker.once('exit', (code) => {
            if (!settled) finish(new Error(`CSG worker exited before completion (${code}).`))
        })
        worker.once('message', (result: { error?: string; scene?: CsgScene }) => finish(result.error ? new Error(result.error) : undefined, result.scene))
        worker.postMessage(source)
    })
}
