import { AlwaysDepth, AlwaysStencilFunc, BackSide, Camera, Color, DepthTexture, DoubleSide, EqualDepth, EqualStencilFunc, NotEqualStencilFunc, FloatType, FrontSide, InvertStencilOp, KeepStencilOp, ReplaceStencilOp, Mesh, NoBlending, RenderTarget, Scene, Vector2, type BufferGeometry, LessEqualDepth, Vector3, Vector4, CustomBlending, MaxEquation, OneFactor } from 'three'
import { MeshBasicNodeMaterial, QuadMesh, type Node, type WebGPURenderer } from 'three/webgpu'
import { RasterOccupancy } from './RasterOccupancy'
import { rasterRegion } from './RasterRegion'
import type { CsgLight } from './CsgModel'
import { estimateRasterWork, planRasterProducts, CSG_RASTER_WORK_LIMIT, type RasterBoundary, type RasterPredicate, type RasterPredicateGroup } from '../../../../../core/csg/rasterWork'
export { CSG_RASTER_WORK_LIMIT, estimateRasterWork } from '../../../../../core/csg/rasterWork'
export type { RasterBoundary } from '../../../../../core/csg/rasterWork'
import { Discard, Fn, If, positionGeometry, attribute, float, depth, dot, normalFlat, faceDirection, normalize, length, max, pow, smoothstep, positionView, screenCoordinate, select, textureLoad, uniform, vec2, vec3, vec4 } from 'three/tsl'

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
    private readonly useFactor = uniform(false)
    private readonly factor = new RenderTarget(1, 1, { depthBuffer: false })
    private factorInitialized = false
    private readonly factorCopyMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false })
    private readonly factorCopy = new QuadMesh(this.factorCopyMaterial)
    private readonly composeMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: CustomBlending, blendEquation: MaxEquation, blendSrc: OneFactor, blendDst: OneFactor, toneMapped: false })
    private readonly compose = new QuadMesh(this.composeMaterial)
    private readonly passScene = new Scene()
    private readonly candidateMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, blending: NoBlending, toneMapped: false })
    private readonly parityMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilWriteMask: 1, stencilFuncMask: 1, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: InvertStencilOp })
    private readonly parityMaterials = Array.from({ length: 8 }, (_, i) => {
        const material = this.parityMaterial.clone()
        material.stencilWriteMask = material.stencilFuncMask = 1 << i
        return material
    })
    private readonly predicateScene = new Scene()
    private readonly predicateMeshes = this.parityMaterials.map((material) => {
        const mesh = new Mesh<BufferGeometry, MeshBasicNodeMaterial>(undefined, material)
        mesh.matrixAutoUpdate = false
        mesh.frustumCulled = false
        return mesh
    })
    private readonly rejectMaterial = new MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, stencilWrite: true, stencilWriteMask: 0, stencilFuncMask: 1, stencilFunc: EqualStencilFunc, toneMapped: false })
    private readonly mergeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, colorWrite: false, depthWrite: true, toneMapped: false })
    // FrontFacingNode specializes to a constant for single-sided materials.
    // Stable materials prevent cached front-side code being reused for back faces.
    private readonly shadeMaterials = [FrontSide, BackSide].map((side) => new MeshBasicNodeMaterial({ side, depthFunc: EqualDepth, depthWrite: false, toneMapped: false }))
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
    private readonly candidateClearMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, depthTest: true, depthFunc: AlwaysDepth, depthWrite: true, toneMapped: false })
    private readonly candidateClear = new QuadMesh(this.candidateClearMaterial)
    private readonly memberClearMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false })
    private readonly memberClear = new QuadMesh(this.memberClearMaterial)
    private readonly maskClearMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false })
    private readonly maskClear = new QuadMesh(this.maskClearMaterial)
    private readonly stencilClearMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilWriteMask: 255, stencilFuncMask: 255, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: ReplaceStencilOp })
    private readonly stencilClear = new QuadMesh(this.stencilClearMaterial)
    private readonly surfaceScene = new Scene()
    private readonly surfaceMerge = new Mesh<BufferGeometry, MeshBasicNodeMaterial>()
    private readonly surfaceShade = new Mesh<BufferGeometry, MeshBasicNodeMaterial>()
    private readonly drawMesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>

    constructor() {
        this.overflowMaterial.fragmentNode = this.overflowTexture
        const membership = textureLoad(this.membership.texture, screenCoordinate)
        this.composeMaterial.fragmentNode = Fn(() => {
            const visible = textureLoad(this.visibility.texture, screenCoordinate).r.mul(select(this.useFactor, textureLoad(this.factor.texture, screenCoordinate).r, float(1)))
            return vec4(select(this.classifyInside, visible, float(0)), select(this.classifyInside, float(0), visible), 0, 1)
        })()
        this.factorCopyMaterial.fragmentNode = textureLoad(this.visibility.texture, screenCoordinate)
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
        for (const material of this.parityMaterials) material.fragmentNode = this.parityMaterial.fragmentNode
        const clipPosition = vec4(positionGeometry.xy, 0, 1)
        for (const material of [this.candidateClearMaterial, this.memberClearMaterial, this.maskClearMaterial, this.stencilClearMaterial, this.rejectMaterial]) material.vertexNode = clipPosition
        this.candidateClearMaterial.fragmentNode = this.memberClearMaterial.fragmentNode = vec4(0)
        this.candidateClearMaterial.depthNode = float(1)
        this.maskClearMaterial.fragmentNode = this.stencilClearMaterial.fragmentNode = vec4(1)
        this.stencilClear.renderOrder = 0
        this.predicateMeshes.forEach((mesh) => {
            mesh.renderOrder = 1
        })
        this.predicateScene.add(this.stencilClear, ...this.predicateMeshes)
        this.rejectMaterial.fragmentNode = vec4(0)
        this.reject = new QuadMesh(this.rejectMaterial)
        this.rejectMaterial.side = DoubleSide
        this.reject.renderOrder = 3
        this.predicateScene.add(this.reject)
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
        for (const material of this.shadeMaterials) {
            material.fragmentNode = shading(select(membership.r.greaterThan(membership.g), float(1), float(-1))).mul(visible)
            material.depthNode = depth
        }
        this.directMaterial.fragmentNode = shading(float(1))
        this.directMaterial.depthNode = depth
        this.drawMesh = new Mesh(undefined, this.candidateMaterial)
        this.drawMesh.matrixAutoUpdate = false
        this.drawMesh.frustumCulled = false
        this.drawMesh.renderOrder = 1
        this.candidateClear.renderOrder = 0
        this.candidateClear.visible = false
        this.passScene.add(this.candidateClear, this.drawMesh)
        for (const mesh of [this.surfaceMerge, this.surfaceShade]) {
            mesh.matrixAutoUpdate = false
            mesh.frustumCulled = false
        }
        this.surfaceMerge.renderOrder = 0
        this.surfaceShade.renderOrder = 1
        this.surfaceScene.add(this.surfaceMerge, this.surfaceShade)
    }

    /** Surfaces are classified with cofactors of the whole expression, so
     * union-internal faces also disappear for a camera inside the result. */
    async render(renderer: WebGPURenderer, camera: Camera, operands: Mesh[], boundaries: RasterBoundary[], overlay = false) {
        const output = renderer.getRenderTarget(),
            autoClear = renderer.autoClear
        const clearColor = renderer.getClearColor(new Color()),
            clearAlpha = renderer.getClearAlpha(),
            clearStencil = renderer.getClearStencil()
        const size = output ? new Vector2(output.width, output.height) : renderer.getDrawingBufferSize(new Vector2())
        // Scratch attachments and completed frame stay within a bounded budget.
        if (size.x * size.y * 40 > 512 * 1048576) throw new Error('CSG viewport resource budget exceeded (512 MB). Reduce the viewport size or display scaling.')
        const scratch = [...this.candidates, this.visibility, this.membership, this.factor]
        const regions = new Map(boundaries.map((boundary) => [boundary.operand, rasterRegion(operands[boundary.operand], camera, size.x, size.y)]))
        const active = boundaries.filter((boundary) => regions.get(boundary.operand))
        const region = (boundary: RasterBoundary) => {
            for (const target of scratch) {
                target.scissor.copy(regions.get(boundary.operand)!)
                target.scissorTest = true
            }
        }
        const checkPassBudget = () => {
            const work = estimateRasterWork(active, this.layerBudgets)
            if (work > CSG_RASTER_WORK_LIMIT) throw new Error(`CSG raster pass budget exceeded (${work} estimated passes). Simplify the expression or select Full Render.`)
        }
        checkPassBudget()
        if (this.candidate.width !== size.x || this.candidate.height !== size.y) {
            for (const target of this.candidates) target.setSize(size.x, size.y)
            this.visibility.setSize(size.x, size.y)
            this.membership.setSize(size.x, size.y)
            this.factor.setSize(size.x, size.y)
            this.factorInitialized = false
        }
        const draw = (operand: Mesh, material: MeshBasicNodeMaterial) => {
            operand.updateWorldMatrix(true, false)
            this.drawMesh.geometry = operand.geometry
            this.drawMesh.matrix.copy(operand.matrixWorld)
            this.drawMesh.material = material
            this.drawMesh.userData = operand.userData
            renderer.render(this.passScene, camera)
        }
        const drawCandidate = (operand: Mesh) => {
            this.candidateClear.visible = true
            try {
                draw(operand, this.candidateMaterial)
            } finally {
                this.candidateClear.visible = false
            }
        }
        const drawPredicates = (predicates: RasterPredicate[]) => {
            for (let i = 0; i < this.predicateMeshes.length; i++) {
                const mesh = this.predicateMeshes[i]
                mesh.visible = i < predicates.length
                if (!mesh.visible) continue
                const operand = operands[predicates[i].operand]
                operand.updateWorldMatrix(true, false)
                mesh.geometry = operand.geometry
                mesh.matrix.copy(operand.matrixWorld)
            }
        }
        const rejectGroup = (group: RasterPredicateGroup, operation: 'any' | 'all', initialize: boolean) => {
            const predicates = group.predicates
            this.stencilClearMaterial.colorWrite = initialize
            this.stencilClearMaterial.stencilRef = 0
            drawPredicates(predicates)
            this.rejectMaterial.stencilFuncMask = (1 << predicates.length) - 1
            this.rejectMaterial.stencilRef = predicates.reduce((bits, predicate, i) => bits | (predicate.inside === (operation === 'all') ? 1 << i : 0), 0)
            this.rejectMaterial.stencilFunc = operation === 'any' ? EqualStencilFunc : NotEqualStencilFunc
            // Reset, all primitive faces and rejection are ordered draws in a
            // single render pass, avoiding full attachment load/store per draw.
            renderer.render(this.predicateScene, camera)
        }
        const classify = (groups: RasterPredicateGroup[]) => {
            if (!groups.length) this.maskClear.render(renderer)
            else groups.forEach((group, i) => rejectGroup(group, 'all', i === 0))
        }
        try {
            renderer.autoClear = false
            renderer.setClearStencil(0)
            if (!this.factorInitialized) {
                renderer.setRenderTarget(this.factor)
                this.factor.scissorTest = false
                this.maskClear.render(renderer)
                this.factorInitialized = true
            }
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
            const direct = active.filter((b) => b.inside.length === 1 && !b.inside[0].intersections.length && !b.inside[0].subtractions.length && !b.outside.length)
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
            const nonconvex = active.filter((b) => !b.convex && !directIds.has(b.operand))
            if (nonconvex.length) {
                if (this.overflow.width !== nonconvex.length) this.overflow.setSize(nonconvex.length, 1)
                let pending = nonconvex
                while (pending.length) {
                    const probeWork = pending.reduce((sum, b) => sum + 2 * ((this.layerBudgets.get(b.operand) ?? 1) + 6), 0)
                    if (probeWork > 50000) throw new Error('CSG depth probing pass budget exceeded. Simplify the model or use Full Render.')
                    renderer.setRenderTarget(this.overflow)
                    renderer.setClearColor(0, 0)
                    renderer.clear(true, false, false)
                    for (const boundary of pending) {
                        region(boundary)
                        this.candidateClear.visible = true
                        for (const target of this.candidates) {
                            target.scissorTest = false
                            renderer.setRenderTarget(target)
                            this.candidateClear.render(renderer)
                            target.scissorTest = true
                        }
                        this.candidateClear.visible = false
                        for (const side of [FrontSide, BackSide]) {
                            const budget = this.layerBudgets.get(boundary.operand) ?? 1
                            for (let layer = 0; layer <= budget; layer++) {
                                const index = layer % 2
                                this.candidate = this.candidates[index]
                                this.previousDepth.value = this.candidates[1 - index].depthTexture!
                                this.peeling.value = layer > 0
                                this.candidateMaterial.side = side
                                renderer.setRenderTarget(this.candidate)
                                drawCandidate(operands[boundary.operand])
                            }
                            const index = budget % 2,
                                reduction = this.occupancy[index].reduce(renderer, this.candidate.texture, size.x, size.y)
                            this.overflowTexture.value = reduction.texture
                            this.overflow.viewport.set(nonconvex.indexOf(boundary), 0, 1, 1)
                            renderer.setRenderTarget(this.overflow)
                            this.overflowQuad.render(renderer)
                        }
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
            for (const boundary of active) {
                if (directIds.has(boundary.operand)) continue
                region(boundary)
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
                        drawCandidate(operand)
                        renderer.setRenderTarget(this.membership)
                        this.memberClear.render(renderer)
                        for (const [terms, inside] of [
                            [boundary.inside, true],
                            [boundary.outside, false],
                        ] as const) {
                            this.includeEqual.value = side === FrontSide ? !inside : inside
                            this.classifyInside.value = inside
                            for (const plan of planRasterProducts(terms)) {
                                if (plan.factors.length) {
                                    renderer.setRenderTarget(this.visibility)
                                    classify(plan.factors)
                                    renderer.setRenderTarget(this.factor)
                                    this.factorCopy.render(renderer)
                                }
                                this.useFactor.value = plan.factors.length > 0
                                for (const batch of plan.batches) {
                                    renderer.setRenderTarget(this.visibility)
                                    if (batch.operation === 'any') rejectGroup(batch.group, 'any', true)
                                    else classify(batch.groups)
                                    renderer.setRenderTarget(this.membership)
                                    this.compose.render(renderer)
                                }
                            }
                        }
                        renderer.setRenderTarget(output)
                        this.mergeMaterial.side = side
                        const shadeMaterial = this.shadeMaterials[side === FrontSide ? 0 : 1]
                        shadeMaterial.transparent = overlay || Number(operand.userData.csgOpacity ?? 1) < 1
                        shadeMaterial.depthFunc = overlay ? LessEqualDepth : EqualDepth
                        this.surfaceMerge.visible = !overlay
                        for (const mesh of [this.surfaceMerge, this.surfaceShade]) {
                            mesh.geometry = operand.geometry
                            mesh.matrix.copy(operand.matrixWorld)
                            mesh.userData = operand.userData
                        }
                        this.surfaceMerge.material = this.mergeMaterial
                        this.surfaceShade.material = shadeMaterial
                        renderer.render(this.surfaceScene, camera)
                    }
                }
            }
        } finally {
            if (!this.disposed) {
                scratch.forEach((target) => {
                    target.scissorTest = false
                })
                renderer.setRenderTarget(output)
                renderer.setClearColor(clearColor, clearAlpha)
                renderer.setClearStencil(clearStencil)
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
            for (const material of [this.candidateMaterial, this.parityMaterial, ...this.parityMaterials, this.mergeMaterial, ...this.shadeMaterials, this.directMaterial]) {
                renderer.setRenderTarget(material.stencilWrite ? this.visibility : this.candidate)
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
        this.factor.dispose()
        this.factorCopyMaterial.dispose()
        for (const material of [this.candidateClearMaterial, this.memberClearMaterial, this.maskClearMaterial, this.stencilClearMaterial]) material.dispose()
        this.composeMaterial.dispose()
        this.parityMaterials.forEach((material) => material.dispose())
        this.visibility.dispose()
        this.warmup.dispose()
        this.overflow.dispose()
        this.overflowMaterial.dispose()
        for (const material of [this.candidateMaterial, this.parityMaterial, this.rejectMaterial, this.mergeMaterial, ...this.shadeMaterials, this.directMaterial]) material.dispose()
    }
}
