import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { assemblyLimits, type KernelPartInput, type KernelResult } from '../../core/assembly/types'

const failure = (code: string): KernelResult => ({ parts: [], pairs: [], complete: false, incomplete: [code], candidateTests: 0 })
let workerPath = join(__dirname, 'assembly-verification-worker.mjs')
export function configureAssemblyWorker(path: string) {
    workerPath = path
}
export function assemblyInWorker(parts: KernelPartInput[], pairs: Array<[string, string]>, signal?: AbortSignal, timeoutMs: number = assemblyLimits.workerMs): Promise<KernelResult> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 512 } })
        let done = false
        const finish = (result?: KernelResult, error?: Error) => {
            if (done) return
            done = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            void worker.terminate()
            if (error) reject(error)
            else resolve(result!)
        }
        const abort = () => finish(undefined, new DOMException('Geometry analysis cancelled', 'AbortError'))
        const timer = setTimeout(() => finish(failure('ASSEMBLY_WORKER_TIMEOUT')), timeoutMs)
        signal?.addEventListener('abort', abort, { once: true })
        worker.once('error', (error) => finish(failure('ASSEMBLY_WORKER_FAILED: ' + error.message.slice(0, 2048))))
        worker.once('exit', (code) => {
            if (!done) finish(failure('ASSEMBLY_WORKER_EXIT: ' + code))
        })
        worker.once('message', (result: KernelResult) => finish(result))
        if (signal?.aborted) {
            abort()
            return
        }
        worker.postMessage({ parts, pairs })
    })
}
