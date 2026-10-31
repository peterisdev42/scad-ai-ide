import { AlwaysStencilFunc, BackSide, Camera, Color, DepthTexture, DoubleSide, EqualDepth, EqualStencilFunc, NotEqualStencilFunc, FloatType, FrontSide, InvertStencilOp, KeepStencilOp, Mesh, NoBlending, RenderTarget, Scene, Vector2, type BufferGeometry, LessEqualDepth, Vector3, Vector4, CustomBlending, MaxEquation, OneFactor } from 'three'
import { MeshBasicNodeMaterial, QuadMesh, type Node, type WebGPURenderer } from 'three/webgpu'
import { RasterOccupancy } from './RasterOccupancy'
import type { CsgLight } from './CsgModel'
import type { CsgProduct } from '../../../../../core/csg/types'
import { Discard, Fn, If, attribute, float, depth, dot, normalFlat, faceDirection, normalize, length, max, pow, smoothstep, positionView, screenCoordinate, select, textureLoad, uniform, vec2, vec3, vec4 } from 'three/tsl'

export interface RasterBoundary {
    operand: number
    inside: CsgProduct[]
    outside: CsgProduct[]
    convex: boolean
}

/** Goldfeather candidate surfaces and stencil parity classification.
 * All visibility work is triangle rasterization. No rays or geometry booleans.
 * Scratch depth is sampled only while a different attachment is being written.
 */
export class RasterCsgRenderer {
    private readonly candidates = [0, 1].map(() => new RenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1, FloatType), samples: 0 }))
    private candidate = this.candidates[0]
    private readonly previousDepth = textureLoad(this.candidates[1].depthTexture!, screenCoordinate)
    private readonly selectedDepth = textureLoad(this.candidates[0].depthTexture!, screenCoordinate)
    private readonly peeling = uniform(false)
    private readonly includeEqual = uniform(false)
    private readonly occupancy = [new RasterOccupancy(), new RasterOccupancy()]
    private disposed = false
    private readonly layerBudgets = new Map<number, number>()
    private readonly overflow = new RenderTarget(1, 1, { depthBuffer: false })
    private readonly overflowTexture = textureLoad(this.candidates[0].texture, vec2(0))
    private readonly overflowMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: CustomBlending, blendEquation: MaxEquation, blendSrc: OneFactor, blendDst: OneFactor, toneMapped: false })
    private readonly overflowQuad = new QuadMesh(this.overflowMaterial)
    private readonly warmup = new RenderTarget(1, 1, { stencilBuffer: true })
    private readonly visibility = new RenderTarget(1, 1, { stencilBuffer: true, samples: 0 })
    private readonly membership = new RenderTarget(1, 1, { depthBuffer: false })
    private readonly classifyInside = uniform(true)
    private readonly composeMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: CustomBlending, blendEquation: MaxEquation, blendSrc: OneFactor, blendDst: OneFactor, toneMapped: false })
    private readonly compose = new QuadMesh(this.composeMaterial)
    private readonly passScene = new Scene()
    private readonly candidateMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, blending: NoBlending, toneMapped: false })
    private readonly parityMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilWriteMask: 1, stencilFuncMask: 1, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: InvertStencilOp })
    private readonly rejectMaterial = new MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, stencilWrite: true, stencilWriteMask: 0, stencilFuncMask: 1, stencilFunc: EqualStencilFunc, toneMapped: false })
    private readonly mergeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, colorWrite: false, depthWrite: true, toneMapped: false })
    private readonly shadeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, depthFunc: EqualDepth, depthWrite: false, toneMapped: false })
    private readonly reject: QuadMesh
    private readonly color = uniform(new Color(0.8, 0.8, 0.8)).onObjectUpdate(({ object }, self) => {
        self.value.copy(object?.userData.csgPaint ?? new Color(0.8, 0.8, 0.8))
    })
    private readonly vertexColors = uniform(false).onObjectUpdate(({ object }) => !!object?.userData.csgVertexColors)
    private readonly directMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, toneMapped: false })
    private readonly directScene = new Scene()
    private readonly lightPositions = Array.from({ length: 16 }, () => uniform(new Vector3(0, 0, 1)))
    private readonly lightColors = Array.from({ length: 16 }, (_, i) => uniform(new Color(i === 0 ? 0.7 : 0, i === 0 ? 0.7 : 0, i === 0 ? 0.7 : 0)))
    private readonly directional = Array.from({ length: 16 }, () => uniform(true))
    private readonly lightParameters = Array.from({ length: 16 }, () => uniform(new Vector4(0, 2, -1, -0.999)))
    private readonly spotDirections = Array.from({ length: 16 }, () => uniform(new Vector3(0, 0, -1)))
    private readonly spot = Array.from({ length: 16 }, () => uniform(false))
    private lights?: CsgLight[]
    private lightAmbient = new Color(0.3, 0.3, 0.3)
    private readonly opacity = uniform(1).onObjectUpdate(({ object }) => Number(object?.userData.csgOpacity ?? 1))
    private readonly ambient = uniform(new Color(0.3, 0.3, 0.3))
    private readonly drawMesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>

    constructor() {
        this.overflowMaterial.fragmentNode = this.overflowTexture
        const membership = textureLoad(this.membership.texture, screenCoordinate)
        this.composeMaterial.fragmentNode = Fn(() => {
            const visible = textureLoad(this.visibility.texture, screenCoordinate).r
            return vec4(select(this.classifyInside, visible, float(0)), select(this.classifyInside, float(0), visible), 0, 1)
        })()
        const candidateDepth = this.selectedDepth.r
        this.candidateMaterial.fragmentNode = Fn(() => {
            If(this.peeling.and(depth.lessThanEqual(this.previousDepth.r)), () => {
                Discard()
            })
            return vec4(1)
        })()
        // Writing the same projected depth in every pass avoids differences
        // between interpolated depth and recomputed shading depth.
        this.candidateMaterial.depthNode = depth
        this.parityMaterial.fragmentNode = Fn(() => {
            If(select(this.includeEqual, depth.lessThan(candidateDepth), depth.lessThanEqual(candidateDepth)), () => {
                Discard()
            })
            return vec4(0)
        })()
        this.rejectMaterial.fragmentNode = vec4(0)
        this.reject = new QuadMesh(this.rejectMaterial)
        const visible = Fn(() => {
            If(membership.r.equal(membership.g).or(depth.notEqual(candidateDepth)), () => {
                Discard()
            })
            return vec4(1)
        })()
        this.mergeMaterial.fragmentNode = visible
        this.mergeMaterial.depthNode = depth
        const shading = (sign: Node<'float'>) =>
            Fn(() => {
                const lighting = this.ambient.rgb.toVar()
                for (let i = 0; i < 16; i++) {
                    const delta = this.lightPositions[i].sub(positionView),
                        distance = length(delta),
                        parameters = this.lightParameters[i]
                    const direction = select(this.directional[i], normalize(this.lightPositions[i]), delta.div(max(distance, 1e-6)))
                    const attenuation = select(this.directional[i], float(1), float(1).div(max(pow(max(distance, 1e-2), parameters.y), 1e-2)))
                    const range = select(parameters.x.greaterThan(0), pow(max(float(1).sub(pow(distance.div(max(parameters.x, 1e-2)), 4)), 0), 2), float(1))
                    const cone = select(this.spot[i], smoothstep(parameters.z, parameters.w, dot(this.spotDirections[i], direction.negate())), float(1))
                    lighting.assign(
                        lighting.add(
                            this.lightColors[i]
                                .mul(dot(normalFlat.mul(faceDirection).mul(sign), direction).max(0))
                                .mul(attenuation)
                                .mul(range)
                                .mul(cone)
                                .mul(1 / Math.PI),
                        ),
                    )
                }
                const source = select(this.vertexColors.and(attribute('scadDefaultColor', 'float').lessThan(0.5)), attribute('scadColor', 'vec4'), vec4(this.color, this.opacity))
                return vec4(source.rgb.mul(lighting), source.a)
            })()
        this.shadeMaterial.fragmentNode = Fn(() => {
            return shading(select(membership.r.greaterThan(membership.g), float(1), float(-1))).mul(visible)
        })()
        this.directMaterial.fragmentNode = shading(float(1))
        this.directMaterial.depthNode = depth
        this.shadeMaterial.depthNode = depth
        this.drawMesh = new Mesh(undefined, this.candidateMaterial)
        this.drawMesh.matrixAutoUpdate = false
        this.drawMesh.frustumCulled = false
        this.passScene.add(this.drawMesh)
    }

    /** Surfaces are classified with cofactors of the whole expression, so
     * union-internal faces also disappear for a camera inside the result. */
    async render(renderer: WebGPURenderer, camera: Camera, operands: Mesh[], boundaries: RasterBoundary[], overlay = false) {
        const output = renderer.getRenderTarget(),
            autoClear = renderer.autoClear
        const clearColor = renderer.getClearColor(new Color()),
            clearAlpha = renderer.getClearAlpha()
        const size = output ? new Vector2(output.width, output.height) : renderer.getDrawingBufferSize(new Vector2())
        // Scratch attachments and completed frame stay within a bounded budget.
        if (size.x * size.y * 36 > 512 * 1048576) throw new Error('CSG viewport resource budget exceeded (512 MB). Reduce the viewport size or display scaling.')
        const checkPassBudget = () => {
            const work = boundaries.reduce((sum, b) => sum + (b.convex ? 1 : (this.layerBudgets.get(b.operand) ?? 1)) * [...b.inside, ...b.outside].reduce((n, p) => n + 3 + (p.intersections.length + p.subtractions.length) * 2, 0), 0)
            if (work > 50000) throw new Error('CSG raster pass budget exceeded. Simplify the model or use Full Render.')
        }
        checkPassBudget()
        if (this.candidate.width !== size.x || this.candidate.height !== size.y) {
            for (const target of this.candidates) target.setSize(size.x, size.y)
            this.visibility.setSize(size.x, size.y)
            this.membership.setSize(size.x, size.y)
        }
        const draw = (operand: Mesh, material: MeshBasicNodeMaterial) => {
            operand.updateWorldMatrix(true, false)
            this.drawMesh.geometry = operand.geometry
            this.drawMesh.matrix.copy(operand.matrixWorld)
            this.drawMesh.material = material
            this.drawMesh.userData = operand.userData
            renderer.render(this.passScene, camera)
        }
        try {
            renderer.autoClear = false
            this.ambient.value.copy(this.lightAmbient)
            if (this.lights)
                for (let i = 0; i < 16; i++) {
                    const light = this.lights[i]
                    this.lightColors[i].value.copy(light?.color ?? new Color(0, 0, 0))
                    if (light) {
                        this.directional[i].value = light.directional
                        this.lightPositions[i].value.copy(light.position)
                        if (light.directional) {
                            if (!this.lightPositions[i].value.lengthSq()) this.lightPositions[i].value.set(0, 0, 1)
                            this.lightPositions[i].value.transformDirection(camera.matrixWorldInverse)
                        } else this.lightPositions[i].value.applyMatrix4(camera.matrixWorldInverse)
                        this.lightParameters[i].value.set(light.distance ?? 0, light.decay ?? 2, light.cone ?? -1, light.penumbra ?? -0.999)
                        this.spot[i].value = !!light.direction
                        if (light.direction) this.spotDirections[i].value.copy(light.direction).transformDirection(camera.matrixWorldInverse)
                    }
                }
            const direct = boundaries.filter((b) => b.inside.length === 1 && !b.inside[0].intersections.length && !b.inside[0].subtractions.length && !b.outside.length)
            const directIds = new Set(direct.map((b) => b.operand))
            if (direct.length) {
                const materials = direct.map((b) => operands[b.operand].material)
                this.directMaterial.transparent = overlay
                this.directMaterial.depthWrite = !overlay
                try {
                    for (const b of direct) {
                        const operand = operands[b.operand]
                        operand.material = this.directMaterial
                        this.directScene.add(operand)
                    }
                    renderer.setRenderTarget(output)
                    renderer.render(this.directScene, camera)
                } finally {
                    direct.forEach((b, i) => {
                        const operand = operands[b.operand]
                        this.directScene.remove(operand)
                        operand.material = materials[i]
                    })
                }
            }
            // Raster reductions return one byte per operand, in one batched
            // readback. Only depth-complexity metadata crosses to the CPU.
            const nonconvex = boundaries.filter((b) => !b.convex && !directIds.has(b.operand))
            if (nonconvex.length) {
                if (this.overflow.width !== nonconvex.length) this.overflow.setSize(nonconvex.length, 1)
                let pending = nonconvex
                while (pending.length) {
                    const probeWork = pending.reduce((sum, b) => sum + 2 * ((this.layerBudgets.get(b.operand) ?? 1) + 6), 0)
                    if (probeWork > 50000) throw new Error('CSG depth probing pass budget exceeded. Simplify the model or use Full Render.')
                    renderer.setRenderTarget(this.overflow)
                    renderer.setClearColor(0, 0)
                    renderer.clear(true, false, false)
                    for (const boundary of pending)
                        for (const side of [FrontSide, BackSide]) {
                            const budget = this.layerBudgets.get(boundary.operand) ?? 1
                            for (let layer = 0; layer <= budget; layer++) {
                                const index = layer % 2
                                this.candidate = this.candidates[index]
                                this.previousDepth.value = this.candidates[1 - index].depthTexture!
                                this.peeling.value = layer > 0
                                this.candidateMaterial.side = side
                                renderer.setRenderTarget(this.candidate)
                                renderer.setClearColor(0, 0)
                                renderer.clear()
                                draw(operands[boundary.operand], this.candidateMaterial)
                            }
                            const index = budget % 2,
                                reduction = this.occupancy[index].reduce(renderer, this.candidate.texture, size.x, size.y)
                            this.overflowTexture.value = reduction.texture
                            this.overflow.viewport.set(nonconvex.indexOf(boundary), 0, 1, 1)
                            renderer.setRenderTarget(this.overflow)
                            this.overflowQuad.render(renderer)
                        }
                    const depths = await renderer.readRenderTargetPixelsAsync(this.overflow, 0, 0, nonconvex.length, 1)
                    if (this.disposed) throw new Error('CSG frame cancelled.')
                    pending = nonconvex.filter((boundary, i) => {
                        if (!depths[i * 4]) return false
                        const budget = this.layerBudgets.get(boundary.operand) ?? 1
                        if (budget >= 64) throw new Error('CSG depth complexity exceeds 64 front/back layers. The last complete frame is retained; use Full Render for this model.')
                        this.layerBudgets.set(boundary.operand, budget * 2)
                        return true
                    })
                }
            }
            checkPassBudget()
            for (const boundary of boundaries) {
                if (directIds.has(boundary.operand)) continue
                const operand = operands[boundary.operand]
                for (const side of [FrontSide, BackSide]) {
                    for (let layer = 0; layer < (boundary.convex ? 1 : (this.layerBudgets.get(boundary.operand) ?? 1)); layer++) {
                        if (this.disposed) throw new Error('CSG frame cancelled.')
                        const index = layer % 2
                        this.candidate = this.candidates[index]
                        this.previousDepth.value = this.candidates[1 - index].depthTexture!
                        this.selectedDepth.value = this.candidate.depthTexture!
                        this.peeling.value = layer > 0
                        this.candidateMaterial.side = side
                        renderer.setRenderTarget(this.candidate)
                        renderer.setClearColor(0, 0)
                        renderer.clear()
                        draw(operand, this.candidateMaterial)
                        renderer.setRenderTarget(this.membership)
                        renderer.setClearColor(0, 0)
                        renderer.clear(true, false, false)
                        for (const [terms, inside] of [
                            [boundary.inside, true],
                            [boundary.outside, false],
                        ] as const)
                            for (const term of terms) {
                                renderer.setRenderTarget(this.visibility)
                                renderer.setClearColor(0xffffff, 1)
                                renderer.clear()
                                const predicates = [...term.intersections.map((operand) => ({ operand, inside: true })), ...term.subtractions.map((operand) => ({ operand, inside: false }))]
                                for (let start = 0; start < predicates.length; start += 8) {
                                    renderer.clear(false, false, true)
                                    let expected = 0,
                                        mask = 0
                                    for (let i = start; i < Math.min(start + 8, predicates.length); i++) {
                                        const predicate = predicates[i],
                                            bit = 1 << (i - start)
                                        mask |= bit
                                        if (predicate.inside) expected |= bit
                                        this.parityMaterial.stencilWriteMask = this.parityMaterial.stencilFuncMask = bit
                                        this.includeEqual.value = side === FrontSide ? !inside : inside
                                        draw(operands[predicate.operand], this.parityMaterial)
                                    }
                                    this.rejectMaterial.stencilFunc = NotEqualStencilFunc
                                    this.rejectMaterial.stencilFuncMask = mask
                                    this.rejectMaterial.stencilRef = expected
                                    this.reject.render(renderer)
                                }
                                this.classifyInside.value = inside
                                renderer.setRenderTarget(this.membership)
                                this.compose.render(renderer)
                            }
                        renderer.setRenderTarget(output)
                        this.mergeMaterial.side = this.shadeMaterial.side = side
                        this.shadeMaterial.transparent = overlay || Number(operand.userData.csgOpacity ?? 1) < 1
                        this.shadeMaterial.depthFunc = overlay ? LessEqualDepth : EqualDepth
                        if (!overlay) draw(operand, this.mergeMaterial)
                        draw(operand, this.shadeMaterial)
                    }
                }
            }
        } finally {
            if (!this.disposed) {
                renderer.setRenderTarget(output)
                renderer.setClearColor(clearColor, clearAlpha)
                renderer.autoClear = autoClear
            }
        }
    }

    invalidateDepthBudgets() {
        this.layerBudgets.clear()
    }

    setLights(lights: CsgLight[], ambient: Color) {
        if (lights.length > 16) throw new Error('CSG supports at most sixteen lights.')
        this.lights = lights
        this.lightAmbient.copy(ambient)
    }

    /** Compile the shared raster shaders without evaluating geometry or exposing
     * an incomplete candidate frame to the viewer. */
    async prepare(renderer: WebGPURenderer, camera: Camera, operands: Mesh[]) {
        const output = renderer.getRenderTarget(),
            autoClear = renderer.autoClear
        this.drawMesh.geometry = operands[0].geometry
        this.drawMesh.matrix.copy(operands[0].matrix)
        let uploadMs = 0
        try {
            for (const material of [this.candidateMaterial, this.parityMaterial, this.mergeMaterial, this.shadeMaterial, this.directMaterial]) {
                renderer.setRenderTarget(material === this.parityMaterial ? this.visibility : this.candidate)
                this.drawMesh.material = material
                await renderer.compileAsync(this.passScene, camera)
            }
            const started = performance.now(),
                seen = new Set<BufferGeometry>()
            renderer.setRenderTarget(this.warmup)
            renderer.autoClear = true
            this.drawMesh.material = this.directMaterial
            for (const operand of operands)
                if (!seen.has(operand.geometry)) {
                    seen.add(operand.geometry)
                    this.drawMesh.geometry = operand.geometry
                    this.drawMesh.matrix.copy(operand.matrix)
                    this.drawMesh.userData = operand.userData
                    renderer.render(this.passScene, camera)
                }
            await renderer.readRenderTargetPixelsAsync(this.warmup, 0, 0, 1, 1)
            uploadMs = performance.now() - started
        } finally {
            renderer.setRenderTarget(output)
            renderer.autoClear = autoClear
        }
        return { uploadMs }
    }

    dispose() {
        this.disposed = true
        this.candidates.forEach((target) => target.dispose())
        this.occupancy.forEach((query) => query.dispose())
        this.membership.dispose()
        this.composeMaterial.dispose()
        this.visibility.dispose()
        this.warmup.dispose()
        this.overflow.dispose()
        this.overflowMaterial.dispose()
        for (const material of [this.candidateMaterial, this.parityMaterial, this.rejectMaterial, this.mergeMaterial, this.shadeMaterial, this.directMaterial]) material.dispose()
    }
}
