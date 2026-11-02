import type { GoldfeatherRenderer } from '../csg/GoldfeatherRenderer'
import { Box3, Camera, Group, Mesh, Raycaster, Scene, Vector3, type Intersection, type Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { ClipPlane, GeometryData } from '../../../../../core/preview/types'
import { withRenderer } from '../passes/RendererJobs'
import { measureBufferUploads } from '../passes/BufferUploadTiming'
import { beginGpuValidation } from '../passes/GpuValidation'

export interface ModelResult<T> {
    modelVersion: number
    value: T
}
export interface ModelPreparation {
    uploadMs: number
    shaderMs: number
    gpuWarmupMs?: number
}
type TopologyProvider = (planes?: ClipPlane[]) => Promise<GeometryData>

export interface PreviewModelRepresentation {
    readonly modelVersion: number
    prepare(renderer: WebGPURenderer, camera: Camera, scene: Scene, signal?: AbortSignal): Promise<ModelResult<ModelPreparation>>
    render(renderer: WebGPURenderer, scene: Scene, camera: Camera): ModelResult<void> | Promise<ModelResult<void>>
    pick(raycaster: Raycaster): ModelResult<Intersection[]>
    queryTopology(planes?: ClipPlane[], signal?: AbortSignal): Promise<ModelResult<GeometryData>>
    dispose(): void
}

/** Versioned model ownership for standard STL/3MF meshes and image-based CSG products. */
export class ModelRepresentation implements PreviewModelRepresentation {
    private disposed = false
    private readonly roots: Object3D[]
    private readonly topologyCache = new Map<string, Promise<ModelResult<GeometryData>>>()
    constructor(
        group: Group,
        public modelVersion: number,
        private topology?: TopologyProvider,
        public readonly imageCsg?: GoldfeatherRenderer,
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
        const finishUploads = this.imageCsg ? () => 0 : measureBufferUploads(renderer)
        const parents = this.roots.map((root) => root.parent)
        let failure: unknown,
            uploadMs = 0,
            shaderMs = 0,
            gpuWarmupMs = 0
        try {
            if (this.imageCsg) {
                const result = await this.imageCsg.prepare(renderer, camera)
                uploadMs = result.uploadMs
                shaderMs = result.shaderMs
                gpuWarmupMs = result.gpuWarmupMs
            } else {
                const shaderStarted = performance.now(),
                    candidate = new Group()
                candidate.add(...this.roots)
                await renderer.compileAsync(candidate, camera, scene)
                shaderMs = performance.now() - shaderStarted
            }
        } catch (error) {
            failure = error
        } finally {
            const uploads = finishUploads()
            if (!this.imageCsg) {
                uploadMs = uploads
                shaderMs = Math.max(0, shaderMs - uploads)
            }
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
        return { modelVersion: this.modelVersion, value: { uploadMs, shaderMs, gpuWarmupMs } }
    }

    render(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
        this.check()
        if (this.imageCsg) this.imageCsg.render(renderer, camera, scene)
        else renderer.render(scene, camera)
        return { modelVersion: this.modelVersion, value: undefined }
    }

    pick(raycaster: Raycaster) {
        this.check()
        return { modelVersion: this.modelVersion, value: this.imageCsg ? this.imageCsg.pick(raycaster) : raycaster.intersectObjects(this.roots, true).filter((hit) => !hit.object.userData.previewOverlay) }
    }

    async queryTopology(planes: ClipPlane[] = [], signal?: AbortSignal) {
        this.check()
        signal?.throwIfAborted()
        const version = this.modelVersion,
            key = JSON.stringify(planes)
        if (this.imageCsg) throw new Error('Image-based preview has no final edge/vertex topology. Use Full Render.')
        let pending = this.topologyCache.get(key)
        if (!pending) {
            pending = (async () => {
                const geometry = planes.length ? await this.topology?.(planes) : this.meshTopology(planes)
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

    private meshTopology(_planes: ClipPlane[]): GeometryData {
        const bounds = new Box3()
        for (const root of this.roots) bounds.expandByObject(root)
        const origin = bounds.getCenter(new Vector3())
        const meshes: GeometryData['meshes'] = [],
            encode = (bytes: Uint8Array) => {
                let binary = ''
                for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
                return btoa(binary)
            }
        for (const root of this.roots) {
            root.updateWorldMatrix(true, true)
            root.traverse((object) => {
                if (!(object instanceof Mesh) || object.userData.csg) return
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
    }

    private check() {
        if (this.disposed) throw new Error('Preview model is disposed.')
    }
    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.topologyCache.clear()
        this.imageCsg?.dispose()
        const geometries = new Set(),
            materials = new Set()
        for (const root of this.roots) {
            root.removeFromParent()
            root.traverse((object) => {
                if (!(object instanceof Mesh) || object.userData.csg) return
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
