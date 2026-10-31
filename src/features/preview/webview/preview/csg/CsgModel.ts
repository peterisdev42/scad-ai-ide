import { packCsgBuffers } from './buffers'
import { BackSide, BoxGeometry, Camera, Color, DataTexture, DirectionalLight,PointLight,SpotLight, FloatType, Matrix4, Mesh, NearestFilter, NoColorSpace, Plane, RGBAFormat, Vector3, Vector4 } from 'three'
import { MeshStandardNodeMaterial, type WebGPURenderer, type Node } from 'three/webgpu'
import { abs, array, bool, Break, cameraNear, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, cross, Discard, dot, exp, float, Fn, If, int, length, Loop, mat3, mat4, max, min, modelWorldMatrix, normalize, normalViewGeometry, normalWorldGeometry, output, overrideNodes, positionView, positionViewDirection, positionWorld, positionGeometry, pow, select, smoothstep, struct, textureLoad, uniform, uniformArray, varying, vec2, vec3, vec4 } from 'three/tsl'
import type { CsgPreviewSceneV2 } from '../../../../../core/csg/types'
import { validateCsgScene } from '../../../../../core/csg/validate'
import { traceCsg } from '../../../../../core/csg/acceleration'

const FAR = 1e30
type N3 = Node<'vec3'>
type N1 = Node<'float'>
export interface CsgLight {
    position: Vector3
    color: Color
    directional: boolean
    direction?: Vector3
    cone?: number
    penumbra?: number
    distance?: number
    decay?: number
    castShadow?: boolean
}

/** Immutable data textures keep the exact same renderer usable on WebGPU and WebGL2. */
function dataTexture(data: Float32Array) {
    const width = Math.min(2048, Math.max(1, Math.ceil(data.length / 4)))
    const height = Math.max(1, Math.ceil(data.length / 4 / width))
    const padded = new Float32Array(width * height * 4)
    padded.set(data)
    const texture = new DataTexture(padded, width, height, RGBAFormat, FloatType)
    texture.minFilter = texture.magFilter = NearestFilter
    texture.colorSpace = NoColorSpace
    texture.needsUpdate = true
    return texture
}

export interface CsgBoundaryOutputs {
    position: N3
    normal: N3
    source: Node<'int'>
    color: Node<'vec4'>
    depth: N1
}
export class CsgModel {
    public readonly outputs: CsgBoundaryOutputs
    public readonly mesh: Mesh<BoxGeometry, MeshStandardNodeMaterial>
    private topology?: Mesh[]
    public setTopology(meshes: Mesh[] | undefined) {
        this.topology = meshes
    }
    private activePlanes: Plane[] = []
    private readonly isOverlay: boolean
    private readonly textures: DataTexture[] = []
    private readonly defaultColor = uniform(new Color())
    private readonly overrideColor = uniform(false)
    private readonly orthographic = uniform(false)
    private readonly clipNear = uniform(0.1)
    private readonly mode = uniform(0, 'int')
    private readonly depthRange = uniform(new Vector4(1, 0, 0, 0))
    private readonly shadows = uniform(true)
    private readonly clipCount = uniform(0, 'int')
    private readonly clipPlanes = Array.from({ length: 8 }, () => uniform(new Vector4(0, 0, 0, 1)))
    private readonly lightCount = uniform(0, 'int')
    private readonly positions = Array.from({ length: 16 }, () => new Vector4())
    private readonly colors = Array.from({ length: 16 }, () => new Vector4())
    private readonly directions = Array.from({ length: 16 }, () => new Vector4())
    private readonly parameters = Array.from({ length: 16 }, () => new Vector4())
    private readonly lightPosition = uniformArray<'vec4'>(this.positions, 'vec4')
    private readonly lightColor = uniformArray<'vec4'>(this.colors, 'vec4')
    private readonly lightDirection = uniformArray<'vec4'>(this.directions, 'vec4')
    private readonly lightParameters = uniformArray<'vec4'>(this.parameters, 'vec4')
    private readonly ambient = uniform(new Color(0.25, 0.25, 0.25))
    private readonly originNode = uniform(new Vector3())
    private readonly diagonal = uniform(1)
    public readonly shadowAt: (world: N3) => N1

    constructor(
        public scene: CsgPreviewSceneV2,
        root = scene.root,
        overlay?: 'highlight' | 'background',
    ) {
        validateCsgScene(scene)
        this.isOverlay = !!overlay
        if (scene.operands.length > 2048 || scene.program.length > 8192) throw new Error('CSG shader resource budget exceeded (2048 operands / 8192 instructions).')
        this.originNode.value.set(...scene.origin)
        const size = scene.bounds.max.map((x, d) => Math.max(x - scene.bounds.min[d], 1e-6))
        this.diagonal.value = Math.hypot(...size)
        const arrays = packCsgBuffers(scene)
        const eventLimit = uniform(scene.triangleCount + 1, 'int'),
            bvhLimit = uniform(arrays[1].length / 12, 'int'),
            tlasLimit = uniform(scene.tlas.length, 'int')
        const [triTexture, bvhTexture, colorTexture, tlasTexture, instanceTexture] = arrays.map(dataTexture)
        this.textures.push(triTexture, bvhTexture, colorTexture, tlasTexture, instanceTexture)
        const load = (tex: DataTexture, index: Node<'int'>) => textureLoad(tex, vec2(index.mod(int(tex.image.width)), index.div(int(tex.image.width))))
        const tri = (i: Node<'int'>, v: number) => load(triTexture, i.mul(3).add(v))
        const node = (i: Node<'int'>, v: number) => load(bvhTexture, i.mul(3).add(v))
        const top = (i: Node<'int'>, v: number) => load(tlasTexture, i.mul(3).add(v))
        const instance = (i: Node<'int'>, v: number) => load(instanceTexture, i.mul(10).add(v))
        const inverse = (id: Node<'int'>) => mat4(instance(id, 0), instance(id, 1), instance(id, 2), instance(id, 3))
        const normalMatrix = (id: Node<'int'>) => mat3(instance(id, 4).xyz, instance(id, 5).xyz, instance(id, 6).xyz)

        // Ray-aligned edge functions give adjacent triangles consistent edge
        // ownership; tolerant barycentric tests can invent overlapping surfaces.
        const triangleHit = Fn(([ro, rd, index]: [N3, N3, Node<'int'>]) => {
            const direction = abs(rd),
                kz = select(direction.x.greaterThan(direction.y).and(direction.x.greaterThan(direction.z)), int(0), select(direction.y.greaterThan(direction.z), int(1), int(2))).toVar(),
                kx = kz.add(1).mod(3),
                ky = kz.add(2).mod(3)
            const component = (v: N3, i: Node<'int'>) => select(i.equal(0), v.x, select(i.equal(1), v.y, v.z))
            const dz = component(rd, kz),
                sx = component(rd, kx).div(dz),
                sy = component(rd, ky).div(dz),
                sz = float(1).div(dz)
            const project = (p: N3) => {
                const q = p.sub(ro).toVar()
                return vec3(component(q, kx).sub(sx.mul(component(q, kz))), component(q, ky).sub(sy.mul(component(q, kz))), sz.mul(component(q, kz))).toVar()
            }
            const a = project(tri(index, 0).xyz),
                b = project(tri(index, 1).xyz),
                c = project(tri(index, 2).xyz)
            const u = c.x.mul(b.y).sub(c.y.mul(b.x)).toVar(),
                v = a.x.mul(c.y).sub(a.y.mul(c.x)).toVar(),
                w = b.x.mul(a.y).sub(b.y.mul(a.x)).toVar(),
                det = u.add(v).add(w).toVar()
            const mixed = min(min(u, v), w)
                .lessThan(0)
                .and(max(max(u, v), w).greaterThan(0))
            const distance = u.mul(a.z).add(v.mul(b.z)).add(w.mul(c.z)).div(det).toVar()
            return vec4(select(mixed.not().and(abs(det).greaterThan(1e-30)), distance, float(FAR)), v.div(det), w.div(det), det)
        })
        const boundsHit = Fn(([ro, rd, lowerBound, upperBound, lower, upper]: [N3, N3, N3, N3, N1, N1]) => {
            const inv = float(1).div(vec3(select(abs(rd.x).lessThan(1e-30), float(1e-30), rd.x), select(abs(rd.y).lessThan(1e-30), float(1e-30), rd.y), select(abs(rd.z).lessThan(1e-30), float(1e-30), rd.z)))
            const padding = max(abs(lowerBound), max(abs(upperBound), abs(ro))).mul(1e-6)
            const a = lowerBound.sub(padding).sub(ro).mul(inv),
                b = upperBound.add(padding).sub(ro).mul(inv),
                lo = min(a, b),
                hi = max(a, b)
            const near = max(max(lo.x, lo.y), max(lo.z, lower)),
                far = min(min(hi.x, hi.y), min(hi.z, upper))
            return near.lessThanEqual(far.add(max(abs(near), abs(far)).mul(8e-7)))
        })
        // Direction is deliberately NOT normalized after the instance transform:
        // local triangle t remains the same world-space ray parameter.
        const visitTriangles = (ro: N3, rd: N3, lower: N1, upper: N1, visit: (triangle: Node<'int'>, operand: Node<'int'>, localOrigin: N3, localDirection: N3) => void) => {
            const cursor = int(0).toVar()
            Loop({ start: int(0), end: tlasLimit, type: 'int' }, () => {
                If(cursor.greaterThanEqual(tlasLimit), () => {
                    Break()
                })
                If(boundsHit(ro, rd, top(cursor, 0).xyz, top(cursor, 1).xyz, lower, upper), () => {
                    const operand = int(top(cursor, 0).w).toVar()
                    If(operand.greaterThanEqual(0), () => {
                        const transform = inverse(operand),
                            localOrigin = transform.mul(vec4(ro, 1)).xyz.toVar(),
                            localDirection = transform.mul(vec4(rd, 0)).xyz.toVar(),
                            metadata = instance(operand, 7).toVar(),
                            localCursor = int(metadata.x).toVar(),
                            end = int(metadata.y).toVar()
                        Loop({ start: int(0), end: bvhLimit, type: 'int' }, () => {
                            If(localCursor.greaterThanEqual(end), () => {
                                Break()
                            })
                            If(boundsHit(localOrigin, localDirection, node(localCursor, 0).xyz, node(localCursor, 1).xyz, lower, upper), () => {
                                const first = int(node(localCursor, 0).w).toVar(),
                                    count = int(node(localCursor, 1).w).toVar()
                                If(first.greaterThanEqual(0), () => {
                                    Loop({ start: int(0), end: count, type: 'int' }, ({ i }) => visit(first.add(i), operand, localOrigin, localDirection))
                                })
                                localCursor.addAssign(1)
                            }).Else(() => {
                                localCursor.assign(int(node(localCursor, 2).x))
                            })
                        })
                    })
                    cursor.addAssign(1)
                }).Else(() => {
                    cursor.assign(int(top(cursor, 2).x))
                })
            })
        }

        const Hit = struct({ distance: 'float', normal: 'vec3', operand: 'int', material: 'int', thickness: 'float', bary: 'vec3' })
        const makeTrace = (withClips: boolean, thickness: boolean) =>
            Fn(([ro, rd, minimum]: [N3, N3, N1]) => {
                const insideArray = array('int', scene.operands.length)
                const inside = insideArray.toVar() as unknown as typeof insideArray
                const flagsArray = array('int', scene.operands.length)
                const flags = flagsArray.toVar() as unknown as typeof flagsArray
                const normalsArray = array('vec3', scene.operands.length)
                const normals = normalsArray.toVar() as unknown as typeof normalsArray
                const barycentricsArray = array('vec3', scene.operands.length)
                const barycentrics = barycentricsArray.toVar() as unknown as typeof barycentricsArray
                const materialsArray = array('int', scene.operands.length)
                const materials = materialsArray.toVar() as unknown as typeof materialsArray
                Loop(scene.operands.length, ({ i }) => {
                    inside.element(i).assign(0)
                })
                const evaluate = () => {
                    const values: Node<'bool'>[] = []
                    for (const instruction of scene.program) {
                        values.push(instruction.op === 'empty' ? bool(false) : instruction.op === 'leaf' ? inside.element(instruction.operand).greaterThan(0) : instruction.op === 'union' ? values[instruction.left].or(values[instruction.right]) : instruction.op === 'intersection' ? values[instruction.left].and(values[instruction.right]) : values[instruction.left].and(values[instruction.right].not()))
                    }
                    return values[root]
                }
                const clipLower = float(-FAR).toVar(),
                    clipUpper = float(FAR).toVar(),
                    capNormal = vec3(0).toVar(),
                    upperNormal = vec3(0).toVar()
                if (withClips)
                    for (let p = 0; p < this.clipPlanes.length; p++) {
                        If(this.clipCount.greaterThan(p), () => {
                            const plane = this.clipPlanes[p]
                            const denominator = dot(rd, plane.xyz).toVar()
                            // Three.js clipping removes negative plane distance.
                            const t = dot(ro, plane.xyz).add(plane.w).negate().div(denominator).toVar()
                            If(abs(denominator).lessThan(1e-20), () => {
                                If(dot(ro, plane.xyz).add(plane.w).lessThan(0), () => {
                                    clipUpper.assign(-FAR)
                                })
                            })
                                .ElseIf(denominator.greaterThan(0), () => {
                                    If(t.greaterThan(clipLower), () => {
                                        clipLower.assign(t)
                                        capNormal.assign(plane.xyz.negate())
                                    })
                                })
                                .Else(() => {
                                    If(t.lessThan(clipUpper), () => {
                                        clipUpper.assign(t)
                                        upperNormal.assign(plane.xyz.negate())
                                    })
                                })
                        })
                    }
                const lower = dot(ro.negate(), rd).sub(this.diagonal.mul(1.01).add(1)).toVar()
                const hitT = float(FAR).toVar(),
                    hitNormal = vec3(0).toVar(),
                    hitId = int(-1).toVar(),
                    hitMaterial = int(0).toVar(),
                    hitBary = vec3(0).toVar(),
                    total = float(0).toVar()
                const intervalStart = float(0).toVar()
                // A line intersects each triangle at most once. This is a geometry-derived
                // bound, not a guessed convexity/event cap that could drop thin geometry.
                Loop({ start: int(0), end: eventLimit, type: 'int' }, () => {
                    const nearest = float(FAR).toVar()
                    visitTriangles(ro, rd, lower, nearest, (id, _operand, localOrigin, localDirection) => {
                        const event = triangleHit(localOrigin, localDirection, id)
                        If(event.x.greaterThan(lower).and(event.x.lessThan(nearest)), () => {
                            nearest.assign(event.x)
                        })
                    })
                    If(nearest.greaterThan(clipUpper), () => {
                        If(evaluate().and(clipUpper.greaterThanEqual(minimum)), () => {
                            total.addAssign(max(0, clipUpper.sub(intervalStart)))
                            If(hitId.lessThan(0), () => {
                                hitT.assign(clipUpper)
                                hitId.assign(0)
                                hitNormal.assign(upperNormal)
                            })
                        })
                        Break()
                    })
                    If(nearest.greaterThanEqual(FAR), () => {
                        Break()
                    })
                    const epsilon = max(abs(nearest).mul(8e-7), float(1e-30)).toVar()
                    Loop(scene.operands.length, ({ i }) => {
                        flags.element(i).assign(0)
                    })
                    visitTriangles(ro, rd, nearest.sub(epsilon), nearest.add(epsilon), (id, operand, localOrigin, localDirection) => {
                        const event = triangleHit(localOrigin, localDirection, id).toVar()
                        If(abs(event.x.sub(nearest)).lessThanEqual(epsilon), () => {
                            const localNormal = cross(tri(id, 1).xyz.sub(tri(id, 0).xyz), tri(id, 2).xyz.sub(tri(id, 0).xyz)),
                                normal = normalize(normalMatrix(operand).mul(localNormal))
                            const flag = select(dot(localNormal, localDirection).lessThan(0), int(1), int(2))
                            flags.element(operand).assign(flags.element(operand).bitOr(flag))
                            normals.element(operand).assign(normal)
                            barycentrics.element(operand).assign(vec3(float(1).sub(event.y).sub(event.z), event.y, event.z))
                            materials.element(operand).assign(int(tri(id, 1).w))
                        })
                    })
                    const before = evaluate().toVar(),
                        previous = bool(before).toVar(),
                        sourceId = int(0).toVar()
                    const rootInstruction = scene.program[root]
                    if (rootInstruction.op === 'leaf' && !scene.operands[rootInstruction.operand].closed)
                        If(flags.element(rootInstruction.operand).greaterThan(0).and(nearest.greaterThanEqual(minimum)).and(nearest.greaterThanEqual(clipLower)), () => {
                            hitT.assign(nearest)
                            hitId.assign(rootInstruction.operand)
                            hitMaterial.assign(materials.element(rootInstruction.operand))
                            hitNormal.assign(normals.element(rootInstruction.operand))
                            hitBary.assign(barycentrics.element(rootInstruction.operand))
                            Break()
                        })
                    If(before.and(clipLower.greaterThanEqual(minimum)).and(clipLower.greaterThan(lower)).and(clipLower.lessThanEqual(nearest)).and(hitId.lessThan(0)), () => {
                        hitT.assign(clipLower)
                        hitId.assign(0)
                        hitNormal.assign(capNormal)
                    })
                    Loop(scene.operands.length, ({ i }) => {
                        If(flags.element(i).equal(1).or(flags.element(i).equal(2)), () => {
                            inside.element(i).assign(select(flags.element(i).equal(1), int(1), int(0)))
                            const state = evaluate().toVar()
                            If(state.xor(previous), () => {
                                sourceId.assign(i)
                                previous.assign(state)
                            })
                        })
                    })
                    const after = evaluate().toVar()
                    If(before.xor(after), () => {
                        If(after, () => {
                            intervalStart.assign(max(nearest, max(minimum, clipLower)))
                        }).Else(() => {
                            total.addAssign(max(0, min(nearest, clipUpper).sub(intervalStart)))
                        })
                        const candidate = max(nearest, clipLower).toVar()
                        If(candidate.greaterThanEqual(minimum).and(candidate.lessThanEqual(clipUpper)).and(hitId.lessThan(0)), () => {
                            // An entering event can be clipped forward to the cap only
                            // while it still belongs to this actual result interval.
                            If(nearest.greaterThanEqual(clipLower), () => {
                                hitT.assign(nearest)
                                hitId.assign(sourceId)
                                hitMaterial.assign(materials.element(sourceId))
                                hitNormal.assign(normals.element(sourceId).mul(select(dot(normals.element(sourceId), rd).lessThan(0).xor(after).not(), float(1), float(-1))))
                                hitBary.assign(barycentrics.element(sourceId))
                            })
                        })
                    })
                    // The cap lies between result events: the current interval is solid.
                    If(after.and(nearest.lessThan(clipLower)).and(hitId.lessThan(0)), () => {
                        intervalStart.assign(max(minimum, clipLower))
                    })
                    If(hitId.greaterThanEqual(0).and(thickness ? this.mode.notEqual(1) : bool(true)), () => {
                        Break()
                    })
                    lower.assign(nearest)
                })
                return Hit(hitT, hitNormal, hitId, hitMaterial, total, hitBary)
            })
        const trace = makeTrace(true, true)
        const traceShadow = makeTrace(true, false)
        const visibility = Fn(([world, direction, limit]: [N3, N3, N1]) => {
            const result = float(1).toVar()
            If(this.shadows, () => {
                const blocker = traceShadow(world.sub(this.originNode), direction, this.diagonal.mul(2e-6)) as unknown as Node<'vec4'>
                const distance = blocker.get('distance') as N1
                result.assign(select(distance.lessThan(limit), float(0), float(1)))
            })
            return result
        })
        this.shadowAt = Fn(([world]: [N3]) => {
            const visible = float(0).toVar(),
                energy = float(0).toVar()
            Loop(16, ({ i }) => {
                If(i.lessThan(this.lightCount), () => {
                    const light = this.lightPosition.element(i),
                        delta = light.xyz.sub(world)
                    const direction = select(light.w.equal(0), light.xyz.normalize(), normalize(delta))
                    const weight = dot(this.lightColor.element(i).xyz, vec3(0.2126, 0.7152, 0.0722))
                    energy.addAssign(weight)
                    visible.addAssign(weight.mul(select(this.lightDirection.element(i).w.greaterThan(0), visibility(world.add(direction.mul(this.diagonal.mul(2e-6))), direction, select(light.w.equal(0), float(FAR), length(delta))), float(1))))
                })
            })
            return select(energy.greaterThan(0), float(0.25).add(float(0.75).mul(visible.div(max(energy, 1e-6)))), float(1))
        })
        const forward = cameraWorldMatrix
            .mul(vec4(0, 0, 1, 0))
            .xyz.negate()
            .normalize()
        const relativeCamera = uniform(new Vector3()).onObjectUpdate(({ camera }, self) => {
            if (camera) self.value.copy(camera.getWorldPosition(new Vector3())).sub(this.originNode.value)
        })
        const relativeView = uniform(new Matrix4()).onObjectUpdate(({ camera }, self) => {
            if (camera) self.value.copy(camera.matrixWorldInverse).multiply(new Matrix4().makeTranslation(...this.originNode.value.toArray()))
        })
        const proxy = varying(positionGeometry, 'csgProxyPosition').context({ inlineVaryings: false })
        const orthographic = cameraProjectionMatrix.mul(vec4(0, 0, 1, 0)).w.equal(0)
        const eye = select(orthographic, proxy.add(forward.mul(dot(relativeCamera.sub(proxy), forward))), relativeCamera)
        const rayDirection = select(orthographic, forward, normalize(proxy.sub(relativeCamera)))
        // Relocate the ray to the closest point to the rebased model origin.
        // Event t now spans model dimensions instead of eye distance, preserving
        // thin intervals even when the camera is far away.
        const shift = dot(eye, rayDirection).negate()
        const rayOrigin = eye.add(rayDirection.mul(shift))
        const minimum = cameraNear.div(max(dot(rayDirection, forward), 1e-6)).sub(shift)
        const hit = (trace(rayOrigin, rayDirection, minimum) as unknown as Node<'vec4'>).toVar()
        const distance = hit.get('distance') as N1,
            normal = hit.get('normal') as N3,
            operand = hit.get('operand') as Node<'int'>
        const relativePoint = rayOrigin.add(rayDirection.mul(distance))
        const worldPoint = relativePoint.add(this.originNode)
        const viewPoint = relativeView.mul(vec4(relativePoint, 1)).xyz
        const projected = cameraProjectionMatrix.mul(vec4(viewPoint, 1))
        // Back faces of the proxy cover each ray exactly once, including when
        // the eye is inside its bounds. The shader writes the true result depth.
        const material = new MeshStandardNodeMaterial({ side: BackSide, shadowSide: BackSide, transparent: true, forceSinglePass: true, depthWrite: !overlay, metalness: 0, roughness: 0.45, fog: false })
        // Renderer coordinate systems differ only in clip Z range.
        material.depthNode = Fn(() => {
            If(operand.lessThan(0), () => {
                Discard()
            })
            return projected.z.div(projected.w).mul(this.depthRange.x).add(this.depthRange.y)
        })()
        const materialId = hit.get('material') as Node<'int'>
        const localRgba = load(colorTexture, materialId.mul(2)),
            localDefault = load(colorTexture, materialId.mul(2).add(1)).x.greaterThan(0.5),
            operandDefault = instance(select(operand.greaterThanEqual(0), operand, int(0)), 9).x.greaterThan(0.5)
        const rgba = select(operandDefault.and(localDefault.not()), localRgba, instance(select(operand.greaterThanEqual(0), operand, int(0)), 8))
        const useDefault = operandDefault.and(localDefault).or(this.overrideColor)
        const base = select(useDefault, this.defaultColor.xyz, rgba.xyz)
        this.outputs = { position: worldPoint, normal, source: operand, color: vec4(base, rgba.w), depth: projected.z.div(projected.w).mul(this.depthRange.x).add(this.depthRange.y) }
        material.colorNode = Fn(() => {
            If(operand.lessThan(0), () => {
                Discard()
            })
            return vec4(base, rgba.w)
        })()
        material.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz
        // Reconstruct the surface per fragment, while vertex processing still
        // projects the proxy. Standard Three lighting and IBL now see the CSG
        // boundary rather than the proxy's position or normal.
        const surfaceContext = overrideNodes(
            [
                [normalViewGeometry, cameraViewMatrix.mul(vec4(normal, 0)).xyz],
                [normalWorldGeometry, normal],
                [positionWorld, worldPoint],
                [positionView, viewPoint],
                [positionViewDirection, normalize(relativeCamera.sub(relativePoint))],
            ],
            null,
            'fragment',
        )
        surfaceContext.value.inlineVaryings = false
        // A CSG proxy must never run its ray program in a directional/spot map
        // or in all six point-light faces. Trace the result only at lit fragments.
        const perLight=new Map<DirectionalLight|PointLight|SpotLight,N1>()
        surfaceContext.value.getShadow=(lightNode:{light:DirectionalLight|PointLight|SpotLight;shadowColorNode:N3})=>{
            const light=lightNode.light
            if(!(light instanceof DirectionalLight||light instanceof PointLight||light instanceof SpotLight))return lightNode.shadowColorNode
            let visibilityNode=perLight.get(light)
            if(!visibilityNode){
                const vector=uniform(new Vector3()).onObjectUpdate((_frame,self)=>{
                    if(light instanceof DirectionalLight)self.value.copy(light.getWorldPosition(new Vector3()).sub(light.target.getWorldPosition(new Vector3()))).normalize()
                    else self.value.copy(light.getWorldPosition(new Vector3())).sub(this.originNode.value)
                })
                visibilityNode=Fn(()=>{
                    const delta=light instanceof DirectionalLight?vector:vector.sub(relativePoint)
                    const direction=normalize(delta),limit=light instanceof DirectionalLight?float(FAR):length(delta),result=float(1).toVar()
                    If(this.shadows.and(this.mode.equal(0)).and(dot(normal,direction).greaterThan(0)),()=>{
                        const blocker=traceShadow(relativePoint.add(direction.mul(this.diagonal.mul(2e-6))),direction,this.diagonal.mul(2e-6)) as unknown as Node<'vec4'>
                        result.assign(select((blocker.get('distance') as N1).lessThan(limit),float(0),float(1)))
                    })
                    return result
                })()
                perLight.set(light,visibilityNode)
            }
            return lightNode.shadowColorNode.mul(visibilityNode)
        }
        material.contextNode = surfaceContext
        material.receivedShadowPositionNode = worldPoint
        material.outputNode = Fn(() => {
            const result = vec4(output).toVar()
            If(this.mode.equal(1), () => {
                result.assign(vec4(base, float(1).sub(exp((hit.get('thickness') as N1).mul(float(-3).div(this.diagonal))))))
            })
            If(this.mode.equal(2), () => {
                If(min(min((hit.get('bary') as N3).x, (hit.get('bary') as N3).y), (hit.get('bary') as N3).z).greaterThan(0.025), () => {
                    Discard()
                })
            })
            if (overlay) result.assign(vec4(overlay === 'highlight' ? vec3(1, 0.15, 0.08) : vec3(0.55), overlay === 'highlight' ? 0.55 : 0.3))
            return result
        })()
        const geometry = new BoxGeometry(...(size as [number, number, number]))
        this.mesh = new Mesh(geometry, material)
        this.mesh.position.set(...scene.origin)
        this.mesh.frustumCulled = false
        this.mesh.userData.csg = this
        this.mesh.raycast = (raycaster, hits) => {
            if (overlay) return
            if (this.topology) {
                hits.push(...raycaster.intersectObjects(this.topology, false))
                return
            }
            const hit = traceCsg(
                this.scene,
                raycaster.ray.origin.toArray(),
                raycaster.ray.direction.toArray(),
                root,
                this.activePlanes.map((p) => ({ normal: p.normal.toArray(), constant: p.constant })),
            )[0]
            if (!hit || hit.distance < raycaster.near || hit.distance > raycaster.far) return
            const point = raycaster.ray.at(hit.distance, new Vector3())
            hits.push({ distance: hit.distance, point, object: this.mesh, face: { a: 0, b: 0, c: 0, normal: new Vector3(...hit.normal), materialIndex: 0 } })
        }
    }

    canReuse(scene: CsgPreviewSceneV2): boolean {
        return scene.operands.length === this.scene.operands.length && scene.triangleCount === this.scene.triangleCount && scene.tlas.length === this.scene.tlas.length && scene.blas.reduce((s, b) => s + b.triangleCount, 0) === this.scene.blas.reduce((s, b) => s + b.triangleCount, 0) && scene.blas.reduce((s, b) => s + b.bvh.length, 0) === this.scene.blas.reduce((s, b) => s + b.bvh.length, 0) && scene.blas.reduce((s, b) => s + b.triangleColors.length, 0) === this.scene.blas.reduce((s, b) => s + b.triangleColors.length, 0) && JSON.stringify(scene.program) === JSON.stringify(this.scene.program) && JSON.stringify(scene.overlays) === JSON.stringify(this.scene.overlays) && scene.root === this.scene.root
    }

    /** Keep pipelines/textures alive for parameter updates with unchanged topology. */
    updateScene(scene: CsgPreviewSceneV2) {
        validateCsgScene(scene)
        if (!this.canReuse(scene)) throw new Error('CSG shader topology changed.')
        const arrays = packCsgBuffers(scene)
        arrays.forEach((source, i) => {
            const texture = this.textures[i],
                target = texture.image.data as Float32Array
            let first = -1,
                last = 0
            for (let j = 0; j < source.length; j++)
                if (target[j] !== source[j]) {
                    if (first < 0) first = j
                    last = j
                    target[j] = source[j]
                }
            if (first >= 0) {
                const start = Math.floor(first / 4) * 4,
                    end = Math.ceil((last + 1) / 4) * 4
                texture.addUpdateRange(start, end - start)
                texture.needsUpdate = true
            }
        })
        this.scene = scene
        this.topology = undefined
        this.originNode.value.set(...scene.origin)
        const size = scene.bounds.max.map((x, d) => Math.max(x - scene.bounds.min[d], 1e-6))
        this.diagonal.value = Math.hypot(...size)
        this.mesh.geometry.dispose()
        this.mesh.geometry = new BoxGeometry(...(size as [number, number, number]))
        this.mesh.position.set(...scene.origin)
    }

    update(camera: Camera, color: Color, override: boolean, mode: 'solid' | 'xray' | 'wireframe', planes: Plane[], webgpu: boolean, shadows = true) {
        this.activePlanes = planes.map((p) => p.clone())
        this.defaultColor.value.copy(color)
        this.overrideColor.value = override
        this.orthographic.value = !!(camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera
        this.clipNear.value = (camera as Camera & { near: number }).near
        this.mode.value = mode === 'xray' ? 1 : mode === 'wireframe' ? 2 : 0
        this.shadows.value = shadows
        this.mesh.castShadow = false
        this.mesh.receiveShadow = shadows && !this.isOverlay
        this.mesh.material.depthWrite = mode !== 'xray' && !this.isOverlay
        this.mesh.material.depthTest = mode !== 'xray'
        this.mesh.renderOrder = mode === 'xray' ? 1000 : this.isOverlay ? 100 : 0
        this.clipCount.value = Math.min(planes.length, this.clipPlanes.length)
        if (planes.length > this.clipPlanes.length) throw new Error('CSG supports at most eight simultaneous clip planes.')
        planes.forEach((p, i) => this.clipPlanes[i].value.set(p.normal.x, p.normal.y, p.normal.z, p.constant + p.normal.dot(this.originNode.value)))
        // Explicit depth conversion is required when the shared renderer chose GL.
        this.depthRange.value.set(webgpu ? 1 : 0.5, webgpu ? 0 : 0.5, 0, 0)
    }

    setLights(lights: CsgLight[], ambient: Color) {
        this.ambient.value.copy(ambient)
        if (lights.length > 16) throw new Error('CSG supports at most sixteen simultaneous lights.')
        this.lightCount.value = lights.length
        lights.forEach((l, i) => {
            this.positions[i].set(l.position.x, l.position.y, l.position.z, l.directional ? 0 : l.direction ? 2 : 1)
            this.colors[i].set(l.color.r, l.color.g, l.color.b, 1)
            this.directions[i].set(l.direction?.x ?? 0, l.direction?.y ?? 0, l.direction?.z ?? 0, l.castShadow ? 1 : 0)
            this.parameters[i].set(l.distance ?? 0, l.decay ?? 2, l.cone ?? -1, l.penumbra ?? -0.999)
        })
    }

    upload(renderer: WebGPURenderer) {
        const backend = renderer.backend as unknown as { device?: { limits: { maxTextureDimension2D: number } }; getContext?: () => WebGL2RenderingContext }
        const gl = backend.getContext?.(),
            maximum = backend.device?.limits.maxTextureDimension2D ?? (gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 2048)
        const bytes = this.textures.reduce((sum, texture) => sum + (texture.image.data as Float32Array).byteLength, 0)
        if (bytes > 256 * 1024 * 1024) throw new Error(`CSG texture memory budget exceeded (${Math.ceil(bytes / 1048576)} MB; maximum 256 MB).`)
        for (const texture of this.textures) {
            if (texture.image.width > maximum || texture.image.height > maximum) throw new Error(`CSG texture exceeds this device's ${maximum} × ${maximum} limit.`)
            renderer.initTexture(texture)
        }
    }

    dispose() {
        this.mesh.geometry.dispose()
        this.mesh.material.dispose()
        this.textures.forEach((t) => t.dispose())
    }
}
