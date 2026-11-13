import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { meshLimits, type GeometryFacts } from '../../core/mesh/types'
import type { ExecutionStatus } from '../../core/cad/types'
export interface MeshWorkerResult {
    executionStatus: ExecutionStatus
    facts?: GeometryFacts
    display?: { bytes: Uint8Array; maxCoordinateError: number }
    error?: { code: string; message: string; unresolved: boolean }
}
let workerPath = join(__dirname, 'mesh-verification-worker.mjs')
export function configureMeshVerificationWorker(path: string) {
    workerPath = path
}
export function analyzeInWorker(bytes: Uint8Array, format: 'stl' | '3mf', signal?: AbortSignal, timeoutMs: number = meshLimits.timeoutMs): Promise<MeshWorkerResult> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 } })
        let done = false
        const finish = (result?: MeshWorkerResult, error?: Error) => {
            if (done) return
            done = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            void worker.terminate()
            if (error) reject(error)
            else resolve(result!)
        }
        const abort = () => finish(undefined, new DOMException('Geometry analysis cancelled', 'AbortError'))
        const timer = setTimeout(() => finish({ executionStatus: 'TIMED_OUT', error: { code: 'MESH_WORKER_TIMEOUT', message: 'Geometry worker exceeded its budget.', unresolved: true } }), timeoutMs)
        signal?.addEventListener('abort', abort, { once: true })
        worker.once('error', (error) => finish({ executionStatus: 'FAILED', error: { code: 'MESH_WORKER_FAILED', message: error.message.slice(0, 2048), unresolved: true } }))
        worker.once('exit', (code) => {
            if (!done) finish({ executionStatus: 'FAILED', error: { code: 'MESH_WORKER_EXIT', message: `Geometry worker exited ${code}. No PASS is available.`, unresolved: true } })
        })
        worker.once('message', (result: MeshWorkerResult) => finish(result))
        if (signal?.aborted) {
            abort()
            return
        }
        const copy = Uint8Array.from(bytes)
        worker.postMessage({ bytes: copy, format }, [copy.buffer])
    })
}
