import { AddEquation, Camera, Color, CustomBlending, DoubleSide, FloatType, Group, Mesh, NearestFilter, OneFactor, OrthographicCamera, PlaneGeometry, Plane, RGBAFormat, Scene, RenderTarget } from 'three'

import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu'
import { abs, exp, faceDirection, float, positionView, texture, uniform, uv, vec4 } from 'three/tsl'

export class XRayPass {
    private renderTarget: RenderTarget
    private thicknessMaterial: MeshBasicNodeMaterial
    private compositeMaterial: MeshBasicNodeMaterial
    private color = uniform(new Color(0xffffff))
    private absorption = uniform(0.05)
    private compositeMesh: Mesh
    private compositeScene: Scene
    private compositeCamera: OrthographicCamera

    constructor(width: number, height: number) {
        this.renderTarget = new RenderTarget(width, height, {
            type: FloatType,
            format: RGBAFormat,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            depthBuffer: false,
            stencilBuffer: false,
        })

        this.thicknessMaterial = new MeshBasicNodeMaterial({
            side: DoubleSide,
            transparent: false,
            depthTest: false,
            depthWrite: false,
            blending: CustomBlending,
            blendEquation: AddEquation,
            blendSrc: OneFactor,
            blendDst: OneFactor,
            blendEquationAlpha: AddEquation,
            blendSrcAlpha: OneFactor,
            blendDstAlpha: OneFactor,
        })

        this.thicknessMaterial.fragmentNode = vec4(positionView.z.mul(faceDirection), 0, 0, 0)

        this.compositeMaterial = new MeshBasicNodeMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })

        this.compositeMaterial.fragmentNode = vec4(this.color, float(1).sub(exp(abs(texture(this.renderTarget.texture, uv()).r).mul(this.absorption).negate())))

        this.compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
        this.compositeMesh = new Mesh(new PlaneGeometry(1, 1), this.compositeMaterial)
        this.compositeMesh.frustumCulled = false
        this.compositeScene = new Scene()
        this.compositeScene.add(this.compositeMesh)
    }

    public setSize(width: number, height: number) {
        this.renderTarget.setSize(width, height)
    }

    public setColor(color: Color) {
        this.color.value.copy(color)
    }

    public setAbsorption(k: number) {
        this.absorption.value = k
    }

    public setClippingPlanes(planes: Plane[]) {
        this.thicknessMaterial.clippingPlanes = planes.length > 0 ? [...planes] : null
        this.thicknessMaterial.needsUpdate = true
    }

    public render(renderer: WebGPURenderer, modelGroup: Group, camera: Camera) {
        // Pass 1: accumulate signed depth into the float RT. Walk the model once,
        // swap each mesh's material for the thickness shader, render the group,
        // then put the originals back. We don't use scene.overrideMaterial because
        // it would also override sibling objects in the scene.
        const restores: { mesh: Mesh; mat: Mesh['material'] }[] = []
        modelGroup.traverse((obj) => {
            if (obj instanceof Mesh) {
                restores.push({ mesh: obj, mat: obj.material })
                obj.material = this.thicknessMaterial
            }
        })

        const prevTarget = renderer.getRenderTarget()
        const prevAutoClear = renderer.autoClear
        const prevShadowEnabled = renderer.shadowMap.enabled
        const prevClearColor = new Color()
        renderer.getClearColor(prevClearColor)
        const prevClearAlpha = renderer.getClearAlpha()

        renderer.shadowMap.enabled = false
        renderer.setRenderTarget(this.renderTarget)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, true, true)
        renderer.autoClear = false
        renderer.render(modelGroup, camera)

        for (const r of restores) r.mesh.material = r.mat

        renderer.setRenderTarget(prevTarget)
        renderer.setClearColor(prevClearColor, prevClearAlpha)
        renderer.shadowMap.enabled = prevShadowEnabled

        // Pass 2: composite the thickness texture onto the current framebuffer.
        // Don't clear — we're blending on top of the already-rendered environment.
        renderer.autoClear = false
        renderer.render(this.compositeScene, this.compositeCamera)
        renderer.autoClear = prevAutoClear
    }

    public dispose() {
        this.renderTarget.dispose()
        this.thicknessMaterial.dispose()
        this.compositeMaterial.dispose()
        this.compositeMesh.geometry.dispose()
    }
}
