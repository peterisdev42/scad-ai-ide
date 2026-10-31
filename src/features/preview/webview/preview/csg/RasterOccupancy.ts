import { RenderTarget, Texture } from 'three'
import { MeshBasicNodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu'
import { Fn, max, min, screenCoordinate, textureLoad, vec2, vec4 } from 'three/tsl'

/** Portable occlusion query substitute: raster maximum reduction, then read one
 * byte. No framebuffer readback or CPU visibility calculation. This is used
 * only to terminate nonconvex depth peeling, never per screen tile. */
export class RasterOccupancy {
    private levels: { target: RenderTarget; material: MeshBasicNodeMaterial; quad: QuadMesh }[] = []
    private source?: Texture

    reduce(renderer: WebGPURenderer, source: Texture, width: number, height: number) {
        if (this.source !== source || this.levels[0]?.target.width !== Math.ceil(width / 8) || this.levels[0]?.target.height !== Math.ceil(height / 8)) {
            this.dispose()
            this.source = source
            let input = source
            do {
                const sourceWidth = width,
                    sourceHeight = height
                width = Math.ceil(width / 8)
                height = Math.ceil(height / 8)
                const target = new RenderTarget(width, height, { depthBuffer: false }),
                    material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false })
                const texture = input
                material.fragmentNode = Fn(() => {
                    const value = textureLoad(texture, vec2(0)).r.mul(0).toVar()
                    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) value.assign(max(value, textureLoad(texture, min(screenCoordinate.floor().mul(8).add(vec2(x, y)), vec2(sourceWidth - 1, sourceHeight - 1))).r))
                    return vec4(value, 0, 0, 1)
                })()
                this.levels.push({ target, material, quad: new QuadMesh(material) })
                input = target.texture
            } while (width > 1 || height > 1)
        }
        for (const level of this.levels) {
            renderer.setRenderTarget(level.target)
            level.quad.render(renderer)
        }
        return this.levels[this.levels.length - 1].target
    }

    dispose() {
        for (const level of this.levels) {
            level.target.dispose()
            level.material.dispose()
        }
        this.levels = []
        this.source = undefined
    }
}
