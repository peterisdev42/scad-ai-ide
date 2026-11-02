import { Box3, Camera, Color, Group, Mesh, Plane, Raycaster, Scene, Vector3, type Intersection, type Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { CsgClipPlane, CsgGeometry, CsgScene } from '../../../../../core/csg/types'
import { CsgModel, type CsgLight } from '../csg/CsgModel'
import { withRenderer } from '../passes/RendererJobs'
import { beginGpuValidation } from '../passes/GpuValidation'

export interface ModelResult<T> {
    modelVersion: number
    value: T
}
export interface ModelFrame {
    color: Color
    overrideColor: boolean
    mode: 'solid' | 'wireframe' | 'xray'
    planes: Plane[]
    webgpu: boolean
    shadows: boolean
    lights: CsgLight[]
    ambient: Color
}
export interface ModelPreparation {
    uploadMs: number
    shaderMs: number
}
type TopologyProvider = (planes?: CsgClipPlane[]) => Promise<CsgGeometry>

export interface PreviewModelRepresentation {
    readonly modelVersion: number
    prepare(renderer: WebGPURenderer, camera: Camera, scene: Scene, signal?: AbortSignal): Promise<ModelResult<ModelPreparation>>
    update(scene: CsgScene, modelVersion: number, topology?: TopologyProvider): boolean
    render(renderer: WebGPURenderer, scene: Scene, camera: Camera, frame?: ModelFrame): ModelResult<void> | Promise<ModelResult<void>>
    pick(raycaster: Raycaster): ModelResult<Intersection[]>
    queryTopology(planes?: CsgClipPlane[], signal?: AbortSignal): Promise<ModelResult<CsgGeometry>>
    dispose(): void
}

/** Owns either prepared mesh roots or GPU CSG roots behind one versioned seam. */
export class ModelRepresentation implements PreviewModelRepresentation {
    private disposed = false
    private readonly roots: Object3D[]
    private readonly topologyCache = new Map<string, Promise<ModelResult<CsgGeometry>>>()
    constructor(
        group: Group,
        public readonly csgModels: CsgModel[],
        public modelVersion: number,
        private topology?: TopologyProvider,
    ) {
        this.roots = [...group.children]
    }

    prepare(renderer: WebGPURenderer, camera: Camera, scene: Scene, signal?: AbortSignal) {
        return withRenderer(renderer, () => this.prepareNow(renderer, camera, scene, signal))
    }
    private async prepareNow(renderer: WebGPURenderer, camera: Camera, scene: Scene, signal?: AbortSignal) {
        signal?.throwIfAborted()
        this.check()
        const validate = beginGpuValidation(renderer, 'preparation')
        const parents = this.roots.map((root) => root.parent)
        let failure: unknown,
            uploadMs = 0,
            shaderMs = 0
        try {
            const shaderStarted = performance.now(),
                candidate = new Group()
            candidate.add(...this.roots)
            await renderer.compileAsync(candidate, camera, scene)
            for (const model of this.csgModels) uploadMs += (await model.prepare(renderer, camera)).uploadMs
            shaderMs = performance.now() - shaderStarted - uploadMs
        } catch (error) {
            failure = error
        } finally {
            this.roots.forEach((root, i) => {
                root.removeFromParent()
                parents[i]?.add(root)
            })
            try {
                await validate()
            } catch (error) {
                failure = error
            }
        }
        if (failure) throw failure
        signal?.throwIfAborted()
        this.check()
        return { modelVersion: this.modelVersion, value: { uploadMs, shaderMs } }
    }

    update(scene: CsgScene, modelVersion: number, topology?: TopologyProvider) {
        this.check()
        if (this.csgModels.length !== scene.overlays.length + 1 || !this.csgModels.every((model) => model.canReuse(scene))) return false
        for (const model of this.csgModels) model.updateScene(scene)
        this.modelVersion = modelVersion
        this.topology = topology
        this.topologyCache.clear()
        return true
    }

    render(renderer: WebGPURenderer, scene: Scene, camera: Camera, frame?: ModelFrame) {
        this.check()
        if (frame)
            for (const model of this.csgModels) {
                model.update(camera, frame.color, frame.overrideColor, frame.mode, frame.planes, frame.webgpu, frame.shadows)
                model.setLights(frame.lights, frame.ambient)
            }
        renderer.render(scene, camera)
        if (this.csgModels.length) return this.renderCsg(renderer, camera)
        return { modelVersion: this.modelVersion, value: undefined }
    }
    private async renderCsg(renderer: WebGPURenderer, camera: Camera) {
        const autoClear = renderer.autoClear
        renderer.autoClear = false
        try {
            for (const model of this.csgModels) await model.render(renderer, camera)
        } finally {
            renderer.autoClear = autoClear
        }
        return { modelVersion: this.modelVersion, value: undefined }
    }

    pick(raycaster: Raycaster) {
        this.check()
        return { modelVersion: this.modelVersion, value: raycaster.intersectObjects(this.roots, true) }
    }

    async queryTopology(planes: CsgClipPlane[] = [], signal?: AbortSignal) {
        this.check()
        signal?.throwIfAborted()
        const version = this.modelVersion,
            key = JSON.stringify(planes)
        let pending = this.topologyCache.get(key)
        if (!pending) {
            pending = (async () => {
                const geometry = this.csgModels.length || planes.length ? await this.topology?.(planes) : this.meshTopology(planes)
                if (!geometry) throw new Error('Exact topology is not available in this preview.')
                if (this.disposed || this.modelVersion !== version) throw new Error('Model changed during topology preparation.')
                return { modelVersion: version, value: geometry }
            })()
            this.topologyCache.set(key, pending)
            while (this.topologyCache.size > 8) this.topologyCache.delete(this.topologyCache.keys().next().value!)
            void pending.catch(() => {
                if (this.topologyCache.get(key) === pending) this.topologyCache.delete(key)
            })
        }
        const result = await pending
        signal?.throwIfAborted()
        return result
    }

    private meshTopology(_planes: CsgClipPlane[]): CsgGeometry {
        const bounds = new Box3()
        for (const root of this.roots) bounds.expandByObject(root)
        const origin = bounds.getCenter(new Vector3())
        const meshes: CsgGeometry['meshes'] = [],
            encode = (bytes: Uint8Array) => {
                let binary = ''
                for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
                return btoa(binary)
            }
        for (const root of this.roots) {
            root.updateWorldMatrix(true, true)
            root.traverse((object) => {
                if (!(object instanceof Mesh)) return
                const position = object.geometry.getAttribute('position'),
                    index = object.geometry.getIndex(),
                    properties = new Float32Array(position.count * 3)
                for (let i = 0; i < position.count; i++) properties.set(new Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld).sub(origin).toArray(), i * 3)
                const indices = new Uint32Array(index ? index.array : Array.from({ length: position.count }, (_, i) => i))
                meshes.push({ stride: 3, properties: encode(new Uint8Array(properties.buffer)), indices: encode(new Uint8Array(indices.buffer)) })
            })
        }
        return { version: 1, origin: origin.toArray(), meshes }
    }

    attach(group: Group) {
        for (const root of this.roots) group.add(root)
    }
    detach() {
        for (const root of this.roots) root.removeFromParent()
    }
    rebind(modelVersion: number, topology?: TopologyProvider) {
        this.check()
        this.modelVersion = modelVersion
        this.topology = topology
        this.topologyCache.clear()
        for (const model of this.csgModels) model.setTopology(undefined)
    }

    private check() {
        if (this.disposed) throw new Error('Preview model is disposed.')
    }
    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.topologyCache.clear()
        const geometries = new Set(),
            materials = new Set()
        for (const root of this.roots) {
            root.removeFromParent()
            root.traverse((object) => {
                if (!(object instanceof Mesh)) return
                if (object.userData.csg instanceof CsgModel) {
                    object.userData.csg.dispose()
                    return
                }
                if (!geometries.has(object.geometry)) {
                    geometries.add(object.geometry)
                    object.geometry.dispose()
                }
                for (const material of Array.isArray(object.material) ? object.material : [object.material])
                    if (!materials.has(material)) {
                        materials.add(material)
                        material.dispose()
                    }
            })
        }
    }
}
