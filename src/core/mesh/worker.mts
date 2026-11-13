import { parentPort } from 'node:worker_threads'
import { decodeMesh } from './decode.js'
import { analyzeMesh } from './analyze.js'
import { displayMesh } from './displayMesh.js'
import { MeshInputError } from './types.js'
parentPort!.once('message', async (request: { bytes: Uint8Array; format: 'stl' | '3mf' }) => {
    try {
        const decoded = decodeMesh(request.bytes, request.format)
        const facts = await analyzeMesh(decoded)
        const display = displayMesh(decoded)
        parentPort!.postMessage({ executionStatus: 'SUCCEEDED', facts, display }, display ? [display.bytes.buffer as ArrayBuffer] : [])
    } catch (error) {
        parentPort!.postMessage({ executionStatus: error instanceof MeshInputError ? 'SUCCEEDED' : 'FAILED', error: { code: error instanceof MeshInputError ? error.code : 'MESH_WORKER_FAILED', message: error instanceof Error ? error.message.slice(0, 2048) : 'Mesh worker failed', unresolved: !(error instanceof MeshInputError) || error.unresolved } })
    }
})
