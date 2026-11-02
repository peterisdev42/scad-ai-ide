import { Camera, RenderTarget, Scene, Vector2 } from 'three'
import { MeshBasicNodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import { withRenderer } from './RendererJobs'
import { beginGpuValidation } from './GpuValidation'

/** CSG candidate frames are published in GPU submission order. Navigation uses
 * the same offscreen target and composition, but omits the per-frame readback
 * fence; the settled/full-quality frame still performs GPU validation. */
export class CsgFramePass {
    private readonly target = new RenderTarget(1, 1, { depthBuffer: true, stencilBuffer: true, samples: 0 })
    private readonly material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false })
    private readonly quad: QuadMesh
    private disposed = false
    private busy = false
    constructor() {
        this.material.fragmentNode = texture(this.target.texture)
        this.quad = new QuadMesh(this.material)
    }
    render(renderer: WebGPURenderer, scene: Scene, camera: Camera, draw: (camera: Camera) => unknown | Promise<unknown>, current: () => boolean, interactive = false): Promise<boolean> {
        return withRenderer(renderer, () => this.renderNow(renderer, scene, camera, draw, current, interactive))
    }
    private async renderNow(renderer: WebGPURenderer, _scene: Scene, camera: Camera, draw: (camera: Camera) => unknown | Promise<unknown>, current: () => boolean, interactive: boolean): Promise<boolean> {
        if (this.disposed || !current()) return false
        const output = renderer.getRenderTarget(),
            autoClear = renderer.autoClear
        const dimensions = output ? new Vector2(output.width, output.height) : renderer.getDrawingBufferSize(new Vector2())
        if (this.target.width !== dimensions.x || this.target.height !== dimensions.y) this.target.setSize(dimensions.x, dimensions.y)
        this.busy = true
        // Shader upload is validated during preparation. Full-quality frames
        // retain their fence and error scopes; navigation must not fence every
        // orbit sample before the texture is composited to the canvas.
        const validate = interactive ? undefined : beginGpuValidation(renderer, 'frame')
        try {
            renderer.setRenderTarget(this.target)
            renderer.autoClear = true
            // The live camera may move while nonconvex layers await a scalar
            // query. Every pass in this frame must use the same camera matrices.
            await draw(camera.clone())
            if (!interactive) {
                await renderer.readRenderTargetPixelsAsync(this.target, Math.floor(dimensions.x / 2), Math.floor(dimensions.y / 2), 1, 1)
                await validate?.()
            }
            if (this.disposed || !current()) return false
            renderer.setRenderTarget(output)
            renderer.autoClear = false
            this.quad.render(renderer)
            return true
        } finally {
            // Also close scopes on cancellation, readback or drawing failure.
            try {
                await validate?.()
            } finally {
                this.busy = false
                renderer.setRenderTarget(output)
                renderer.autoClear = autoClear
                if (this.disposed) this.release()
            }
        }
    }
    private release() {
        this.target.dispose()
        this.material.dispose()
    }
    dispose() {
        if (this.disposed) return
        this.disposed = true
        if (!this.busy) this.release()
    }
}
