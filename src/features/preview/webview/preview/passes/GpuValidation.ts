import type { WebGPURenderer } from 'three/webgpu'

type Device = {
    pushErrorScope(kind: 'validation' | 'out-of-memory' | 'internal'): void
    popErrorScope(): Promise<{ message: string } | null>
}

/** Call under RendererJobs: error scopes and shader callbacks are renderer
 * state. Validation errors can otherwise log to the console and return black
 * pixels without rejecting a readback. Close before publishing the frame. */
export function beginGpuValidation(renderer: WebGPURenderer, phase: string) {
    const device = (renderer.backend as unknown as { device?: Device }).device
    const previous = renderer.debug.onShaderError
    let closed = false
    let shaderError: Error | undefined
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        shaderError = new Error(`Preview shader compilation failed: ${[gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n').slice(0, 4000)}`)
    }
    device?.pushErrorScope('internal')
    device?.pushErrorScope('out-of-memory')
    device?.pushErrorScope('validation')
    return async () => {
        if (closed) return
        closed = true
        renderer.debug.onShaderError = previous
        let failure: Error | undefined
        if (device)
            for (let i = 0; i < 3; i++) {
                try {
                    const error = await device.popErrorScope()
                    if (error) failure ??= new Error(`Preview GPU ${phase} failed: ${error.message}`)
                } catch (error) {
                    failure ??= error instanceof Error ? error : new Error(String(error))
                }
            }
        if (failure || shaderError) throw failure ?? shaderError
    }
}
