import { Box3, Camera, Color, Group, Mesh, Plane, Raycaster, Scene, Vector3, type Intersection, type Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { CsgClipPlane, CsgGeometry, CsgScene } from '../../../../../core/csg/types'
import { CsgModel, type CsgLight } from '../csg/CsgModel'

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
    render(renderer: WebGPURenderer, scene: Scene, camera: Camera, frame?: ModelFrame): ModelResult<void>
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

    private static readonly preparations = new WeakMap<WebGPURenderer, Promise<unknown>>()
    prepare(renderer: WebGPURenderer, camera: Camera, scene: Scene, signal?: AbortSignal) {
        // GPU error scopes are a device stack; serialize candidates on this renderer.
        const previous = ModelRepresentation.preparations.get(renderer) ?? Promise.resolve()
        const pending = previous.catch(() => {}).then(() => this.prepareNow(renderer, camera, scene, signal))
        ModelRepresentation.preparations.set(renderer, pending)
        void pending
            .finally(() => {
                if (ModelRepresentation.preparations.get(renderer) === pending) ModelRepresentation.preparations.delete(renderer)
            })
            .catch(() => {})
        return pending
    }
    private async prepareNow(renderer: WebGPURenderer, camera: Camera, scene: Scene, signal?: AbortSignal) {
        signal?.throwIfAborted()
        this.check()
        const device = (renderer.backend as unknown as { device?: { pushErrorScope: (kind: 'validation' | 'out-of-memory') => void; popErrorScope: () => Promise<{ message: string } | null> } }).device
        device?.pushErrorScope('out-of-memory')
        device?.pushErrorScope('validation')
        const previous = renderer.debug.onShaderError
        let shaderError: Error | undefined
        renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
            shaderError = new Error(`Preview shader compilation failed: ${[gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n').slice(0, 4000)}`)
        }
        const start = performance.now(),
            parents = this.roots.map((root) => root.parent)
        let failure: unknown,
            uploadMs = 0,
            shaderMs = 0
        try {
            for (const model of this.csgModels) model.upload(renderer)
            if (this.csgModels.length) await renderer.waitForGPU()
            uploadMs = performance.now() - start
            const shaderStarted = performance.now(),
                candidate = new Group()
            candidate.add(...this.roots)
            await renderer.compileAsync(candidate, camera, scene)
            shaderMs = performance.now() - shaderStarted
        } catch (error) {
            failure = error
        } finally {
            this.roots.forEach((root, i) => {
                root.removeFromParent()
                parents[i]?.add(root)
            })
            renderer.debug.onShaderError = previous
            if (device) {
                const validation = await device.popErrorScope(),
                    memory = await device.popErrorScope()
                if (validation || memory) failure = new Error(`Preview GPU preparation failed: ${(validation ?? memory)!.message}`)
            }
        }
        if (failure) throw failure
        if (shaderError) throw shaderError
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
