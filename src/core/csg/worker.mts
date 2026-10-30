import { parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import Module from 'manifold-3d'
import { evaluateCsg } from './evaluate.mjs'

const manifold = await Module({ locateFile: () => fileURLToPath(new URL('./manifold.wasm', import.meta.url)) })
manifold.setup()
parentPort!.on('message', (source: string) => {
    try {
        parentPort!.postMessage({ scene: evaluateCsg(source, manifold) })
    } catch (error) {
        parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
})
