import { parentPort } from 'node:worker_threads'
import { analyzeAssembly } from './AssemblyKernel.js'
import type { KernelPartInput } from './types.js'
parentPort!.once('message', async (request: { parts: KernelPartInput[]; pairs: Array<[string, string]> }) => {
    try {
        const result = await analyzeAssembly(request.parts, request.pairs)
        parentPort!.postMessage(result)
    } catch (error) {
        parentPort!.postMessage({ parts: [], pairs: [], complete: false, incomplete: [error instanceof Error ? error.message : 'ASSEMBLY_WORKER_FAILED'], candidateTests: 0 })
    }
})
