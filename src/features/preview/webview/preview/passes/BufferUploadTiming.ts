import type { WebGPURenderer } from 'three/webgpu'

/** CPU time spent creating/submitting vertex/index buffers during compileAsync.
 * This is not a GPU timestamp or pure PCIe transfer time. Called under RendererJobs. */
export function measureBufferUploads(renderer: WebGPURenderer) {
    type Upload = (...args: unknown[]) => unknown
    const backend = renderer.backend as unknown as Record<string, Upload>
    const originals = new Map<string, Upload>()
    let milliseconds = 0
    for (const name of ['createAttribute', 'createIndexAttribute', 'updateAttribute']) {
        const original = backend[name]
        if (typeof original !== 'function') continue
        originals.set(name, original)
        backend[name] = function (...args) {
            const start = performance.now()
            try {
                return original.apply(this, args)
            } finally {
                milliseconds += performance.now() - start
            }
        }
    }
    return () => {
        for (const [name, original] of originals) backend[name] = original
        return milliseconds
    }
}
