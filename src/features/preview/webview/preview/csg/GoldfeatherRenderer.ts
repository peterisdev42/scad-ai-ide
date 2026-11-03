import type { CsgPartHint } from '../../../../../core/preview/csgParts'
import { hintAt, hintColor } from '../managers/CsgPartColors'
import { AlwaysDepth, AlwaysStencilFunc, BackSide, BufferGeometry, Camera, Color, DoubleSide, EqualStencilFunc, Float32BufferAttribute, FloatType, FrontSide, GreaterDepth, Group, HalfFloatType, IncrementStencilOp, InvertStencilOp, KeepStencilOp, Matrix4, Mesh, NearestFilter, NoBlending, OrthographicCamera, PlaneGeometry, Raycaster, RenderTarget, Scene, Uint32BufferAttribute, Vector2, Vector3, type Intersection, type Light } from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu'
import { expression, float, Fn, lights, screenUV, texture, vec4 } from 'three/tsl'
import type { PreviewGroup, PreviewProduct, PreviewScene } from '../../../../../core/preview/types'
import { decodeFloats, decodeIndices, tracePreview } from '../../../../../core/preview/query'
import { partColor } from '../managers/PartColors'
import { measureBufferUploads } from '../passes/BufferUploadTiming'

// Use the rasterizer's depth in both passes, rather than independently reconstructing
// perspective depth from interpolated view positions (which can differ by one ULP).
// Three r187 exposes only fragCoord.xy through TSL; preserve the builtin registered
// by the backend and select its z component. Keep this adapter version-local.
const rasterDepth = Fn((builder) => {
    const coordinate = (builder as unknown as { getFragCoord(): string }).getFragCoord()
    if (!coordinate.endsWith('.xy')) throw new Error('Unsupported Three.js fragment coordinate accessor.')
    // ExpressionNode's older typings omit its scalar node type. Fn wraps it in TSL.
    return expression(coordinate.slice(0, -3) + '.z', 'float') as unknown as ReturnType<typeof float>
})()

/** Standard Goldfeather: candidate layer -> z-fail parity trimming -> depth/colour merge.
 * Reference: OpenCSG 1.8.2 renderGoldfeather.cpp and primitiveHelper.cpp::renderLayer.
 * The stencil parity test rasterizes closed operands; no ray/BVH query runs in a shader.
 * Convexity bounds candidate layers, as in OpenCSG's standard Goldfeather variant. */
export class GoldfeatherRenderer {
    readonly root = new Group()
    private readonly partIds = new Map<number, number>()
    private hints?: readonly CsgPartHint[]
    private readonly hintedColors = new Map<number, Color>()
    private readonly geometries: BufferGeometry[]
    private readonly proxies: Mesh[]
    private readonly draws: Mesh[]
    private readonly frame = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, stencilBuffer: true })
    private readonly presentMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: NoBlending })
    private readonly present = new QuadMesh(this.presentMaterial)
    private readonly emptyWorld = new Scene()
    private readonly mask = new RenderTarget(1, 1, { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true, stencilBuffer: true })
    private readonly candidate = [FrontSide, BackSide].map((side) => new MeshBasicNodeMaterial({ side, blending: NoBlending, depthFunc: AlwaysDepth, stencilWrite: true, stencilFunc: EqualStencilFunc, stencilRef: 0, stencilFail: IncrementStencilOp, stencilZFail: IncrementStencilOp, stencilZPass: IncrementStencilOp }))
    private readonly parity = new MeshBasicNodeMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false, depthFunc: GreaterDepth, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilWriteMask: 1, stencilFuncMask: 1, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: InvertStencilOp })
    private readonly trim = [0, 1].map((ref) => new MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, blending: NoBlending, stencilWrite: true, stencilFunc: EqualStencilFunc, stencilRef: ref, stencilFuncMask: 1, stencilWriteMask: 0 }))
    private readonly shade = new Map<string, MeshStandardNodeMaterial>()
    private readonly passScene = new Scene()
    private readonly quadScene = new Scene()
    private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.trim[0])
    private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    private lightKey = 'uninitialized'
    private disposed = false
    public lastTimings = { booleanSubmitMs: 0, colorSubmitMs: 0, booleanPasses: 0 }

    constructor(readonly scene: PreviewScene) {
        for (const group of ['products', 'highlights', 'backgrounds'] as const) for (const p of scene[group]) if (p.intersections.length + p.subtractions.length > 1 && [...p.intersections, ...p.subtractions].some((t) => scene.instances[t.id].convexity > 255)) throw new Error('Goldfeather candidate convexity exceeds the 8-bit stencil layer limit (255).')
        this.presentMaterial.fragmentNode = texture(this.frame.texture, screenUV)
        this.root.position.set(...scene.origin)
        this.geometries = scene.meshes.map((mesh) => {
            const geometry = new BufferGeometry()
            geometry.setAttribute('position', new Float32BufferAttribute(decodeFloats(mesh.properties), 3))
            geometry.setIndex(new Uint32BufferAttribute(decodeIndices(mesh.indices), 1))
            return geometry
        })
        const parent = scene.instances.map((_, i) => i)
        const find = (id: number): number => {
            while (parent[id] !== id) {
                parent[id] = parent[parent[id]]
                id = parent[id]
            }
            return id
        }
        for (const product of scene.products) for (const term of product.intersections) parent[find(term.id)] = find(product.intersections[0].id)
        const parts = new Map<number, number>()
        for (const product of scene.products) {
            if (!product.intersections.length) continue
            const root = find(product.intersections[0].id)
            if (!parts.has(root)) parts.set(root, parts.size)
            for (const term of product.intersections) this.partIds.set(term.id, parts.get(root)!)
        }
        for (const product of scene.products) for (const term of product.subtractions) if (!this.partIds.has(term.id) && product.intersections.length) this.partIds.set(term.id, this.partIds.get(product.intersections[0].id)!)
        this.proxies = scene.instances.map((instance) => {
            const mesh = new Mesh(this.geometries[instance.mesh], this.parity)
            mesh.matrixAutoUpdate = false
            mesh.matrix.fromArray(instance.inverse).invert()
            mesh.visible = false
            mesh.userData.csg = true // exact edge topology is not provided by an image renderer
            this.root.add(mesh)
            return mesh
        })
        this.draws = scene.instances.map((instance, i) => {
            const mesh = new Mesh(this.geometries[instance.mesh], this.parity)
            mesh.matrixAutoUpdate = false
            mesh.frustumCulled = false
            mesh.name = `CSGP instance ${i}`
            return mesh
        })
        for (const material of this.candidate) material.fragmentNode = vec4(rasterDepth, 0, 0, 1)
        for (const material of this.trim) material.fragmentNode = vec4(0)
        this.quad.frustumCulled = false
        this.quadScene.add(this.quad)
        for (const group of ['products', 'backgrounds', 'highlights'] as const)
            for (const product of scene[group]) {
                const terms = [...product.intersections.map((t) => ({ ...t, negative: false })), ...product.subtractions.map((t) => ({ ...t, negative: true }))]
                for (const term of terms) this.material(term.id, group, term.negative, terms.length > 1)
            }
    }

    private material(id: number, group: PreviewGroup, negative: boolean, masked: boolean) {
        const key = `${id}:${group}:${negative}:${masked}`
        let material = this.shade.get(key)
        if (!material) {
            const instance = this.scene.instances[id]
            material = new MeshStandardNodeMaterial({ color: new Color(...(instance.color.slice(0, 3) as [number, number, number])), opacity: instance.color[3], side: masked ? (negative ? BackSide : FrontSide) : DoubleSide, roughness: 0.75, metalness: 0, transparent: instance.color[3] < 1 || group !== 'products', depthWrite: group === 'products' })
            if (group === 'highlights') {
                material.color.setRGB(1, 81 / 255, 81 / 255)
                material.opacity = 128 / 255
            }
            if (group === 'backgrounds' && instance.defaultColor) {
                material.color.setRGB(180 / 255, 180 / 255, 180 / 255)
                material.opacity = 128 / 255
            }
            if (masked) {
                const sample = texture(this.mask.texture, screenUV)
                material.maskNode = sample.a.greaterThan(0.5).and(rasterDepth.equal(sample.r))
            }
            this.shade.set(key, material)
        }
        return material
    }

    updateAppearance(color: Color, override: boolean, world: Scene, cutout: Color = color, partColors = false, hints?: readonly CsgPartHint[]) {
        if (this.hints !== hints) {
            this.hints = hints
            this.hintedColors.clear()
            if (hints?.length)
                for (const [id, part] of this.partIds) {
                    const bounds = this.scene.instances[id].bounds
                    const point = bounds.min.map((n, d) => (n + bounds.max[d]) / 2 + this.scene.origin[d])
                    const hint = hintAt(hints, point)
                    if (hint && !this.hintedColors.has(part)) this.hintedColors.set(part, hintColor(hint))
                }
        }
        const sourceLights: Light[] = []
        world.traverseVisible((object) => {
            if ((object as Light).isLight) sourceLights.push(object as Light)
        })
        const key = sourceLights.map((l) => l.id).join(',')
        const lighting = key !== this.lightKey ? lights(sourceLights) : undefined
        this.lightKey = key
        for (const [key, material] of this.shade) {
            const [id, group, negative] = key.split(':')
            const instance = this.scene.instances[Number(id)]
            if (group === 'products') {
                if (partColors) material.color.copy(this.hintedColors.get(this.partIds.get(Number(id)) ?? 0) ?? partColor(this.partIds.get(Number(id)) ?? 0))
                else if (override) material.color.copy(color)
                else if (instance.defaultColor) material.color.copy(negative === 'true' ? cutout : color)
                else material.color.setRGB(...(instance.color.slice(0, 3) as [number, number, number]))
            }
            if (lighting) {
                material.lightsNode = lighting
                material.needsUpdate = true
            }
        }
    }

    private draw(renderer: WebGPURenderer, camera: Camera, id: number, material: MeshBasicNodeMaterial | MeshStandardNodeMaterial) {
        const mesh = this.draws[id]
        mesh.material = material
        mesh.matrix.copy(this.proxies[id].matrixWorld)
        this.passScene.add(mesh)
        try {
            renderer.render(this.passScene, camera)
        } finally {
            mesh.removeFromParent()
        }
    }

    async prepare(renderer: WebGPURenderer, camera: Camera) {
        this.root.updateWorldMatrix(true, true)
        const target = renderer.getRenderTarget(),
            autoClear = renderer.autoClear,
            finishUploads = measureBufferUploads(renderer),
            started = performance.now()
        let uploadMs = 0,
            gpuWarmupMs = 0
        try {
            this.mask.setSize(1, 1)
            renderer.setRenderTarget(this.mask)
            renderer.autoClear = false
            renderer.clear(true, true, true)
            const mesh = this.draws[0]
            if (mesh)
                for (const material of [...this.candidate, this.parity]) {
                    mesh.material = material
                    mesh.matrix.copy(this.proxies[0].matrixWorld)
                    this.passScene.add(mesh)
                    // r187 compileAsync omits stencil state in its render context.
                    // Warm real stencil pipelines in the private 1x1 attachment instead.
                    renderer.render(this.passScene, camera)
                    mesh.removeFromParent()
                }
            for (const material of this.trim) {
                this.quad.material = material
                renderer.render(this.quadScene, this.quadCamera)
            }
            this.frame.setSize(1, 1)
            renderer.setRenderTarget(this.frame)
            if (mesh)
                for (const [key, material] of this.shade) {
                    const instance = Number(key.split(':')[0]),
                        object = this.draws[instance]
                    object.material = material
                    object.matrix.copy(this.proxies[instance].matrixWorld)
                    this.passScene.add(object)
                    await renderer.compileAsync(this.passScene, camera)
                    object.removeFromParent()
                }
            renderer.setRenderTarget(target)
            await renderer.compileAsync(this.present, this.present.camera)
            const waitStarted = performance.now()
            await renderer.readRenderTargetPixelsAsync(this.mask, 0, 0, 1, 1)
            gpuWarmupMs = performance.now() - waitStarted
        } finally {
            uploadMs = finishUploads()
            renderer.setRenderTarget(target)
            renderer.autoClear = autoClear
            this.passScene.clear()
        }
        return { uploadMs, gpuWarmupMs, shaderMs: Math.max(0, performance.now() - started - uploadMs - gpuWarmupMs) }
    }

    render(renderer: WebGPURenderer, camera: Camera, world?: Scene) {
        if (this.disposed) throw new Error('Goldfeather renderer is disposed.')
        const target = renderer.getRenderTarget(),
            autoClear = renderer.autoClear
        const size = target ? new Vector2(target.width, target.height) : renderer.getDrawingBufferSize(new Vector2())
        this.frame.setSize(size.x, size.y)
        try {
            // Candidate depths are single-sample. Shading into MSAA attachments changes
            // interpolation/sample locations, breaking exact equality at triangle seams.
            // Render the entire world to the same single-sample grid, then present once.
            renderer.setRenderTarget(this.frame)
            renderer.autoClear = true
            const sceneStarted = performance.now()
            renderer.render(world ?? this.emptyWorld, camera)
            const sceneMs = performance.now() - sceneStarted
            this.renderProducts(renderer, camera)
            renderer.setRenderTarget(target)
            const presentStarted = performance.now()
            this.present.render(renderer)
            this.lastTimings.colorSubmitMs += sceneMs + performance.now() - presentStarted
        } finally {
            renderer.setRenderTarget(target)
            renderer.autoClear = autoClear
        }
    }

    private renderProducts(renderer: WebGPURenderer, camera: Camera) {
        if (this.disposed) throw new Error('Goldfeather renderer is disposed.')
        const target = renderer.getRenderTarget(),
            autoClear = renderer.autoClear,
            clearColor = renderer.getClearColor(new Color()),
            clearAlpha = renderer.getClearAlpha(),
            shadow = renderer.shadowMap.enabled
        const size = target ? new Vector2(target.width, target.height) : renderer.getDrawingBufferSize(new Vector2())
        this.mask.setSize(size.x, size.y)
        this.root.updateWorldMatrix(true, true)
        this.lastTimings = { booleanSubmitMs: 0, colorSubmitMs: 0, booleanPasses: 0 }
        try {
            renderer.autoClear = false
            renderer.shadowMap.enabled = false
            for (const group of ['products', 'backgrounds', 'highlights'] as const) {
                const direct = new Set(this.scene[group].filter((p) => p.intersections.length === 1 && !p.subtractions.length).map((p) => p.intersections[0].id))
                if (direct.size) {
                    const started = performance.now()
                    for (const id of direct) {
                        const mesh = this.draws[id]
                        mesh.material = this.material(id, group, false, false)
                        mesh.matrix.copy(this.proxies[id].matrixWorld)
                        this.passScene.add(mesh)
                    }
                    try {
                        renderer.render(this.passScene, camera)
                    } finally {
                        this.passScene.clear()
                    }
                    this.lastTimings.colorSubmitMs += performance.now() - started
                }
                for (const product of this.scene[group]) if (product.intersections.length + product.subtractions.length > 1) this.renderProduct(renderer, camera, target, product, group)
            }
        } finally {
            renderer.setRenderTarget(target)
            renderer.autoClear = autoClear
            renderer.setClearColor(clearColor, clearAlpha)
            renderer.shadowMap.enabled = shadow
        }
    }

    private renderProduct(renderer: WebGPURenderer, camera: Camera, output: RenderTarget | null, product: PreviewProduct, group: PreviewGroup) {
        const terms = [...product.intersections.map((t) => ({ ...t, negative: false })), ...product.subtractions.map((t) => ({ ...t, negative: true }))]
        for (const candidate of terms)
            for (let layer = 0; layer < this.scene.instances[candidate.id].convexity; layer++) {
                const started = performance.now()
                renderer.setRenderTarget(this.mask)
                renderer.setClearColor(0, 0)
                renderer.clear(true, true, true)
                const material = this.candidate[Number(candidate.negative)]
                material.stencilRef = layer
                this.draw(renderer, camera, candidate.id, material)
                this.lastTimings.booleanPasses++
                for (const other of terms) {
                    if (other.id === candidate.id) continue
                    // Goldfeather omits negative operands whose boxes cannot touch the candidate.
                    if (other.negative && !this.overlaps(candidate.id, other.id)) continue
                    renderer.clear(false, false, true)
                    this.draw(renderer, camera, other.id, this.parity)
                    this.quad.material = this.trim[Number(other.negative)]
                    renderer.render(this.quadScene, this.quadCamera)
                    this.lastTimings.booleanPasses += 2
                }
                this.lastTimings.booleanSubmitMs += performance.now() - started
                const colorStarted = performance.now()
                renderer.setRenderTarget(output)
                this.draw(renderer, camera, candidate.id, this.material(candidate.id, group, candidate.negative, true))
                this.lastTimings.colorSubmitMs += performance.now() - colorStarted
            }
    }

    private overlaps(a: number, b: number) {
        const x = this.scene.instances[a].bounds,
            y = this.scene.instances[b].bounds
        return [0, 1, 2].every((d) => x.max[d] >= y.min[d] && y.max[d] >= x.min[d])
    }

    pick(raycaster: Raycaster): Intersection[] {
        this.root.updateWorldMatrix(true, true)
        const transform = new Matrix4().makeTranslation(...this.scene.origin).multiply(this.root.matrixWorld.clone().invert())
        const sourceRay = raycaster.ray.clone().applyMatrix4(transform)
        return tracePreview(this.scene, sourceRay.origin.toArray(), sourceRay.direction.toArray())
            .map((hit) => {
                const point = sourceRay.at(hit.distance, new Vector3()).applyMatrix4(transform.clone().invert())
                return { distance: point.distanceTo(raycaster.ray.origin), point, object: this.proxies[hit.operand], face: { a: 0, b: 1, c: 2, normal: new Vector3(...hit.normal), materialIndex: 0 } }
            })
            .filter((hit) => hit.distance >= raycaster.near && hit.distance <= raycaster.far)
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.mask.dispose()
        this.frame.dispose()
        this.presentMaterial.dispose()
        this.quad.geometry.dispose()
        this.geometries.forEach((g) => g.dispose())
        for (const material of [...this.candidate, this.parity, ...this.trim, ...this.shade.values()]) material.dispose()
        this.root.removeFromParent()
        this.root.clear()
        this.passScene.clear()
    }
}
