import { BoxGeometry, BufferAttribute, BufferGeometry, Camera, Color, Matrix4, Mesh, MeshBasicMaterial, Plane, Vector3 } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { CsgScene } from '../../../../../core/csg/types'
import { validateCsgScene } from '../../../../../core/csg/validate'
import { decodeFloats, decodeIndices, traceCsg } from '../../../../../core/csg/acceleration'
import { boundaryCofactors } from '../../../../../core/csg/normalize'
import { RasterCsgRenderer, type RasterBoundary } from './RasterCsgRenderer'

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
const geometryCache = new WeakMap<CsgScene, { geometries: BufferGeometry[]; references: number }>()

function acquireGeometry(scene: CsgScene) {
    let shared = geometryCache.get(scene)
    if (!shared || shared.references === 0) {
        const geometries = scene.meshes.map((mesh, index) => {
            const properties = decodeFloats(mesh.properties),
                count = properties.length / mesh.stride,
                positions = new Float32Array(count * 3)
            const colors = new Float32Array(count * 4),
                defaults = new Float32Array(count)
            for (let i = 0; i < count; i++) {
                for (let d = 0; d < 3; d++) positions[i * 3 + d] = properties[i * mesh.stride + d] - scene.meshOrigins[index][d]
                for (let d = 0; d < 4; d++) colors[i * 4 + d] = mesh.stride >= 8 ? properties[i * mesh.stride + 3 + d] : 1
                defaults[i] = mesh.stride >= 8 ? properties[i * mesh.stride + 7] : 1
            }
            const geometry = new BufferGeometry()
            geometry.setAttribute('position', new BufferAttribute(positions, 3))
            geometry.setAttribute('scadColor', new BufferAttribute(colors, 4))
            geometry.setAttribute('scadDefaultColor', new BufferAttribute(defaults, 1))
            geometry.setIndex(new BufferAttribute(decodeIndices(mesh.indices), 1))

            geometry.computeBoundingBox()
            return geometry
        })
        shared = { geometries, references: 0 }
        geometryCache.set(scene, shared)
    }
    shared.references++
    return shared
}

/** Viewer-facing model. Geometry and boolean products are immutable between
 * edits; camera motion only schedules raster passes. CPU BVHs are lazy picking
 * resources and have no GPU representation. */
export class CsgModel {
    public readonly mesh: Mesh<BoxGeometry, MeshBasicMaterial>
    private readonly renderer = new RasterCsgRenderer()
    private shared: { geometries: BufferGeometry[]; references: number }
    private readonly operands: Mesh<BufferGeometry, MeshBasicMaterial>[]
    private boundaries: RasterBoundary[] = []
    private topology?: Mesh[]
    private activePlanes: Plane[] = []
    private disposed = false
    private rendering?: Promise<void>

    constructor(
        public scene: CsgScene,
        private readonly root = scene.root,
        private readonly overlay?: 'highlight' | 'background',
    ) {
        validateCsgScene(scene)
        this.boundaries = this.prepareBoundaries(scene)
        const shared = (this.shared = acquireGeometry(scene))
        this.operands = scene.operands.map((o) => {
            const mesh = new Mesh(shared.geometries[o.mesh], new MeshBasicMaterial())
            mesh.matrixAutoUpdate = false
            mesh.frustumCulled = false
            return mesh
        })
        const size = scene.bounds.max.map((x, d) => Math.max(x - scene.bounds.min[d], 1e-6)) as [number, number, number]
        this.mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ visible: false }))
        this.mesh.position.set(...scene.origin)
        this.mesh.frustumCulled = false
        this.mesh.userData.csg = this
        this.mesh.raycast = (raycaster, hits) => {
            if (this.overlay) return
            if (this.topology) {
                hits.push(...raycaster.intersectObjects(this.topology, false))
                return
            }
            const hit = traceCsg(
                this.scene,
                raycaster.ray.origin.toArray(),
                raycaster.ray.direction.toArray(),
                this.scene.topologyRoot,
                this.activePlanes.map((p) => ({ normal: p.normal.toArray(), constant: p.constant })),
            )[0]
            if (hit && hit.distance >= raycaster.near && hit.distance <= raycaster.far) hits.push({ distance: hit.distance, point: raycaster.ray.at(hit.distance, new Vector3()), object: this.mesh, face: { a: 0, b: 0, c: 0, normal: new Vector3(...hit.normal), materialIndex: 0 } })
        }
        this.update(new Camera(), new Color(0.8, 0.8, 0.8), false, 'solid', [], true)
    }

    private prepareBoundaries(scene: CsgScene) {
        const products = this.root === scene.root ? scene.products : (scene.overlays.find((o) => o.root === this.root)?.products ?? [])
        const ids = new Set(products.flatMap((p) => [...p.intersections, ...p.subtractions]))
        if (ids.size * scene.program.length > 2000000) throw new Error('CSG boundary normalization budget exceeded. Simplify the expression or use Full Render.')
        let literals = 0,
            terms = 0
        return [...ids]
            .map((id) => {
                const box = scene.operands[id].bounds,
                    constants = new Map<number, boolean>()
                for (const other of ids)
                    if (other !== id) {
                        const b = scene.operands[other].bounds
                        if (box.min.some((x, d) => x > b.max[d]) || box.max.some((x, d) => x < b.min[d])) constants.set(other, false)
                    }
                const boundary = { operand: id, ...boundaryCofactors(scene.program, this.root, id, constants), convex: scene.operands[id].convex }
                for (const term of [...boundary.inside, ...boundary.outside]) {
                    terms++
                    literals += term.intersections.length + term.subtractions.length
                }
                if (terms > 16384 || literals > 131072) throw new Error('CSG boundary product budget exceeded. Simplify the expression or use Full Render.')
                return boundary
            })
            .filter((b) => b.inside.length || b.outside.length)
    }

    setTopology(meshes: Mesh[] | undefined) {
        this.topology = meshes
    }
    canReuse(scene: CsgScene) {
        return !this.rendering && scene.operands.length === this.scene.operands.length && JSON.stringify(scene.program) === JSON.stringify(this.scene.program) && JSON.stringify(scene.overlays) === JSON.stringify(this.scene.overlays) && scene.root === this.scene.root && scene.topologyRoot === this.scene.topologyRoot
    }
    updateScene(scene: CsgScene) {
        validateCsgScene(scene)
        if (!this.canReuse(scene)) throw new Error('CSG geometry changed during update.')
        const boundaries = this.prepareBoundaries(scene)
        const sameGeometry = scene.geometryKeys.length === this.scene.geometryKeys.length && scene.geometryKeys.every((key, i) => key === this.scene.geometryKeys[i])
        if (!sameGeometry) {
            this.renderer.invalidateDepthBudgets()
            const next = acquireGeometry(scene),
                previous = this.shared
            this.shared = next
            this.operands.forEach((mesh, i) => (mesh.geometry = next.geometries[scene.operands[i].mesh]))
            if (--previous.references === 0) previous.geometries.forEach((geometry) => geometry.dispose())
        } else geometryCache.set(scene, this.shared)
        this.scene = scene
        this.topology = undefined
        this.mesh.position.set(...scene.origin)
        this.mesh.geometry.dispose()
        this.mesh.geometry = new BoxGeometry(...(scene.bounds.max.map((x, d) => Math.max(x - scene.bounds.min[d], 1e-6)) as [number, number, number]))
        this.boundaries = boundaries
    }
    update(_camera: Camera, color: Color, override: boolean, _mode: 'solid' | 'xray' | 'wireframe', planes: Plane[], _webgpu: boolean, _shadows = true) {
        this.activePlanes = planes.map((p) => p.clone())
        this.operands.forEach((mesh, i) => {
            const operand = this.scene.operands[i]
            mesh.material.color.copy(override || operand.defaultColor ? color : new Color(...(operand.color.slice(0, 3) as [number, number, number])))
            mesh.userData.csgPaint = mesh.material.color
            mesh.userData.csgOpacity = operand.color[3]
            mesh.userData.csgVertexColors = !override && operand.defaultColor
            if (this.overlay) {
                mesh.material.color.set(this.overlay === 'highlight' ? 0xff2614 : 0x888888)
                mesh.userData.csgOpacity = this.overlay === 'highlight' ? 0.55 : 0.3
                mesh.userData.csgVertexColors = false
            }
        })
    }
    setLights(lights: CsgLight[], ambient: Color) {
        this.renderer.setLights(lights, ambient)
    }
    async prepare(renderer: WebGPURenderer, camera: Camera) {
        return this.operands.length ? this.renderer.prepare(renderer, camera, this.operands) : { uploadMs: 0 }
    }
    render(renderer: WebGPURenderer, camera: Camera) {
        if (this.disposed) throw new Error('CSG model is disposed.')
        if (!this.mesh.visible) return Promise.resolve()
        this.mesh.updateWorldMatrix(true, false)
        this.operands.forEach((mesh, i) => {
            mesh.matrix.copy(this.mesh.matrixWorld).multiply(new Matrix4().fromArray(this.scene.operands[i].inverse).invert())
            mesh.updateMatrixWorld(true)
        })
        const pending = this.renderer.render(renderer, camera, this.operands, this.boundaries, !!this.overlay)
        this.rendering = pending
        return pending.finally(() => {
            if (this.rendering === pending) this.rendering = undefined
            if (this.disposed) this.release()
        })
    }
    private release() {
        this.renderer.dispose()
        this.mesh.geometry.dispose()
        this.mesh.material.dispose()
        this.operands.forEach((mesh) => mesh.material.dispose())
        if (--this.shared.references === 0) this.shared.geometries.forEach((geometry) => geometry.dispose())
    }
    dispose() {
        if (this.disposed) return
        this.disposed = true
        if (!this.rendering) this.release()
    }
}
