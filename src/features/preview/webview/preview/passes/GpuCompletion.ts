import { RenderTarget } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

/** r187 has no waitForGPU(). A tiny queued readback fences all earlier work,
 * including canvas submissions, through the same public API on both backends. */
export class GpuCompletion {
    private readonly marker = new RenderTarget(1, 1, { depthBuffer: false })
    wait(renderer: WebGPURenderer) {
        const target = renderer.getRenderTarget()
        try {
            renderer.setRenderTarget(this.marker)
            renderer.clear(true, false, false)
            return renderer.readRenderTargetPixelsAsync(this.marker, 0, 0, 1, 1).then(() => {})
        } finally {
            renderer.setRenderTarget(target)
        }
    }
    dispose() {
        this.marker.dispose()
    }
}
