import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { CsgScene, CsgGeometry, CsgCachedGeometry, CsgClipPlane } from './types'
const geometryCache = new Map<string, CsgCachedGeometry>()
let cachedBytes = 0
const entryBytes = (entry: CsgCachedGeometry) => entry.mesh.properties.length + entry.mesh.indices.length + entry.blas.triangles.length + entry.blas.triangleColors.length + entry.blas.bvh.length * 96
const cacheBudget = 64 * 1024 * 1024

let workerPath = join(__dirname, 'csg-worker.mjs')
export function configureCsgWorker(path: string) {
    workerPath = path
    geometryCache.clear()
    cachedBytes = 0
}

/** Each job owns its worker, so cancellation can stop synchronous WASM work immediately. */
export function compileCsg(source: string, signal?: AbortSignal, options: { cwd?: string; fontDirectories?: string[]; dependencies?: { path: string; stamp: string }[] } = {}): Promise<Buffer> {
    return runCsgWorker({ source, ...options, cached: Object.fromEntries(geometryCache) }, signal).then((buffer) => {
        const scene = JSON.parse(buffer.toString('utf8')) as CsgScene
        scene.geometryKeys.forEach((key, i) => {
            const entry = { mesh: scene.meshes[i], blas: scene.blas[i] },
                previous = geometryCache.get(key)
            if (previous) {
                geometryCache.delete(key)
                cachedBytes -= entryBytes(previous)
            }
            geometryCache.set(key, entry)
            cachedBytes += entryBytes(entry)
        })
        while (cachedBytes > cacheBudget && geometryCache.size) {
            const key = geometryCache.keys().next().value!
            const mesh = geometryCache.get(key)!
            cachedBytes -= entryBytes(mesh)
            geometryCache.delete(key)
        }
        return buffer
    })
}

export async function compileCsgTopology(scene: CsgScene, signal?: AbortSignal, planes?: CsgClipPlane[]): Promise<CsgGeometry> {
    return JSON.parse((await runCsgWorker({ topology: scene, planes }, signal)).toString('utf8')) as CsgGeometry
}

/** Standard path topology uses the existing bytes and the same host geometry kernel. */
export async function compileMeshTopology(content: string, format: 'stl' | '3mf', signal?: AbortSignal, planes?: CsgClipPlane[]): Promise<CsgGeometry> {
    return JSON.parse((await runCsgWorker({ meshTopology: { content, format }, planes }, signal)).toString('utf8')) as CsgGeometry
}

function runCsgWorker(request: unknown, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 512 } })
        let settled = false
        const finish = (error?: Error, scene?: CsgScene | CsgGeometry) => {
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
        worker.once('message', (result: { error?: string; scene?: CsgScene | CsgGeometry }) => finish(result.error ? new Error(result.error) : undefined, result.scene))
        worker.postMessage(request)
    })
}
