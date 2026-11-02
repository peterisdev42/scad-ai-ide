import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { ClipPlane, GeometryData } from '../preview/types'
let workerPath = join(__dirname, 'mesh-topology-worker.mjs')
export function configureMeshTopologyWorker(path: string) {
    workerPath = path
}
/** Standalone STL/3MF tools retain their mesh kernel without any preview evaluator. */
export function queryMeshTopology(content: string, format: 'stl' | '3mf', signal?: AbortSignal, planes: ClipPlane[] = []): Promise<GeometryData> {
    if (!['stl', '3mf'].includes(format) || content.length > 128 * 1048576 || planes.length > 8) return Promise.reject(new Error('Invalid mesh topology request.'))
    for (const p of planes) if (p.normal.length !== 3 || ![...p.normal, p.constant].every(Number.isFinite) || Math.hypot(...p.normal) < 1e-12) return Promise.reject(new Error('Invalid clipping plane.'))
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 512 } })
        let settled = false
        const finish = (error?: Error, result?: GeometryData) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            signal?.removeEventListener('abort', abort)
            void worker.terminate()
            if (error) reject(error)
            else resolve(result!)
        }
        const abort = () => finish(new Error('Mesh topology cancelled'))
        const timeout = setTimeout(() => finish(new Error('Mesh topology timed out.')), 60000)
        signal?.addEventListener('abort', abort, { once: true })
        worker.once('error', (error) => finish(error))
        worker.once('exit', (code) => {
            if (!settled) finish(new Error(`Mesh topology worker exited (${code}).`))
        })
        worker.once('message', (message: { error?: string; geometry?: GeometryData }) => finish(message.error ? new Error(message.error) : undefined, message.geometry))
        worker.postMessage({ content, format, planes })
    })
}
