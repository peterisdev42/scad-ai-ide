import { Box3, BufferGeometry, Color, Float32BufferAttribute, FogExp2, Group, Mesh, MeshStandardMaterial, Object3D, PCFShadowMap, Plane, Raycaster, Scene, Uint32BufferAttribute, Vector2, Vector3, WebGLRenderer } from 'three'
import type { CsgScene } from '../../../../core/csg/types'

// OpenSCAD uses Z-up; align Three.js to match so models load without reorientation.
// Setting DEFAULT_UP before any Object3D is constructed makes every camera, light,
// and helper inherit Z-up via its constructor (camera.up, TrackballControls behavior, …).
Object3D.DEFAULT_UP.set(0, 0, 1)
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ModelFormat } from '../../shared/types/ModelFormat'
import { ActiveTool } from '../contexts/ActiveToolContext'
import { ModelContext } from '../contexts/ModelContext'
import { ObjectProperties } from '../contexts/SelectedObjectContext'
import { SceneObjectType } from '../contexts/SceneContext'
import { Environment, RenderMode, ViewOptionsContext } from '../contexts/ViewOptionsContext'
import { XRayPass } from './passes/XRayPass'
import { AmbientLightRig } from './rigs/AmbientLightRig'
import { CameraRig, type CameraViewState } from './rigs/CameraRig'
import { DirectionalLightRig } from './rigs/DirectionalLightRig'
import { MeasurementRig } from './rigs/MeasurementRig'
import { PointLightRig } from './rigs/PointLightRig'
import { Rig } from './rigs/Rig'
import { SpotLightRig } from './rigs/SpotLightRig'
import { buildPlateResetBounds } from './managers/BuildPlateLayout'
import { fitDirectionalShadow } from './managers/Lighting'
import { createStudioEnvironment, studioSurface } from './managers/StudioAppearance'
import { MaterialManager } from './managers/MaterialManager'
import { ToolManager } from './managers/ToolManager'
import { CrossSectionRig } from './rigs/CrossSectionRig'
import { EnvironmentManager } from './managers/EnvironmentManager'
import { MeasureTool } from './tools/MeasureTool'
import { MoveTool } from './tools/MoveTool'
import { RotateTool } from './tools/RotateTool'
import { ScaleTool } from './tools/ScaleTool'
import { SelectTool } from './tools/SelectTool'
import { ViewCubeWidget } from './widgets/ViewCubeWidget'

import type { Theme } from './Theme'
export type { Theme } from './Theme'

// Model sits between tier 0 cap (11) and tier 1 stencil (20) so all tiers
// except tier 0 can depth-test against the model when their cap renders.
const MODEL_CLIP_RENDER_ORDER = 15

// Snap translation to 1mm, rotate to 5° — applied when Ctrl is held.
const TRANSLATION_SNAP = 1
const ROTATION_SNAP = Math.PI / 36

export class Stage {
    private container: HTMLElement
    private studioEnvironment: ReturnType<typeof createStudioEnvironment>
    private renderer: WebGLRenderer
    private css2dRenderer: CSS2DRenderer
    private scene: Scene

    private cameraHandles = new Map<string, CameraRig>()
    private activeCameraRig!: CameraRig
    private environmentRig: EnvironmentManager
    private materialManager: MaterialManager
    private toolManager: ToolManager
    private xrayPass: XRayPass

    private modelGroup: Group
    private viewCube: ViewCubeWidget
    private viewOptions?: ViewOptionsContext
    private fitInitialModel = false

    // Scene object registry
    private handles = new Map<string, Rig>()
    private selectedId: string | null = null
    private onSelectionChange: ((id: string | null) => void) | null = null
    private onPropertiesChange: ((props: ObjectProperties | null) => void) | null = null

    // Shared TransformControls — one instance, attaches to selected object's pivot
    private transformControls: TransformControls
    private gizmoMode: 'translate' | 'rotate' | null = null
    private gizmoJustInteracted = false
    private snapEnabled = false

    private animationFrameId: number | null = null
    private pointerDownX = 0
    private pointerDownY = 0
    private theme: Theme
    private disposed = false
    private paused = false

    private raycaster: Raycaster
    private toolVariant: string | null = null

    private onObjectRegistered: ((id: string, type: SceneObjectType) => void) | null = null

    private onPersist: (() => void) | null = null

    constructor(container: HTMLElement, theme: Theme) {
        this.container = container
        this.theme = theme
        this.raycaster = new Raycaster()
        this.toolManager = new ToolManager()

        // 1. Core Three.js scene
        this.scene = new Scene()
        this.scene.background = this.theme.background

        // 2. Renderers
        const { clientWidth: width, clientHeight: height } = container
        this.renderer = new WebGLRenderer({ antialias: true, stencil: true })
        this.renderer.setPixelRatio(window.devicePixelRatio)
        this.renderer.setSize(width || 1, height || 1)
        this.renderer.shadowMap.type = PCFShadowMap
        this.renderer.shadowMap.enabled = true
        this.studioEnvironment = createStudioEnvironment(this.renderer)
        this.scene.environment = this.studioEnvironment.texture
        this.scene.environmentIntensity = 0.45
        // The studio environment is Y-up; OpenSCAD and this scene are Z-up.
        this.scene.environmentRotation.x = Math.PI / 2
        this.renderer.domElement.classList.add('main-canvas')
        this.container.appendChild(this.renderer.domElement)

        this.css2dRenderer = new CSS2DRenderer()
        this.css2dRenderer.setSize(width || 1, height || 1)
        this.css2dRenderer.domElement.style.position = 'absolute'
        this.css2dRenderer.domElement.style.top = '0'
        this.css2dRenderer.domElement.style.pointerEvents = 'none'
        this.container.appendChild(this.css2dRenderer.domElement)

        // Record input before the camera navigation's capture listeners consume drags.
        this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true)
        this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove, true)

        // 3. Rigs — default camera created here; App.ts registers it as a scene object
        const defaultCamera = this.createCameraRig('camera-default')
        this.activeCameraRig = defaultCamera
        defaultCamera.setIsActiveCamera(true)
        this.environmentRig = new EnvironmentManager(Environment.None, this.theme)
        this.scene.add(this.environmentRig.group)
        this.materialManager = new MaterialManager()
        this.xrayPass = new XRayPass(width || 1, height || 1)
        this.xrayPass.setColor(this.theme.foreground)

        // 4. Groups and widgets
        this.modelGroup = new Group()
        this.scene.add(this.modelGroup)
        this.viewCube = new ViewCubeWidget(
            container,
            (direction, kind) => {
                if (kind === 'edge') this.activeCameraRig.orientToEdge(direction)
                else this.activeCameraRig.orientTo(direction)
            },
            (angle) => this.activeCameraRig.roll(angle),
        )

        // 5. Shared TransformControls
        this.transformControls = new TransformControls(this.activeCameraRig.getPerspectiveCamera(), this.renderer.domElement)
        this.scene.add(this.transformControls.getHelper())

        this.transformControls.addEventListener('mouseDown', () => {
            this.gizmoJustInteracted = true
        })
        this.transformControls.addEventListener('mouseUp', () => {
            // Snap rotation to absolute world-space multiples on release when Ctrl held
            if (this.snapEnabled && this.transformControls.mode === 'rotate' && this.selectedId) {
                const handle = this.handles.get(this.selectedId)
                if (handle instanceof CrossSectionRig) {
                    handle.snapRotation(ROTATION_SNAP)
                }
            }
            setTimeout(() => {
                this.gizmoJustInteracted = false
            }, 0)
        })
        this.transformControls.addEventListener('change', () => {
            // Broadcast updated properties to the SelectedObjectContext on every frame
            if (this.selectedId) {
                const handle = this.handles.get(this.selectedId)
                if (handle) this.onPropertiesChange?.(handle.getProperties())
            }
        })

        // Suspend orbit while gizmo is dragged
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.activeCameraRig.getControls().enabled = !(event as unknown as { value: boolean }).value
        })

        // 7. Input handlers
        this.renderer.domElement.addEventListener('click', this.handleCanvasClick)

        // 8. Default tool
        this.toolManager.setBindings({ canvas: this.renderer.domElement })
        this.toolManager.switchTo(new SelectTool())

        // 9. Start
        this.startAnimationLoop()
    }

    public dispose() {
        if (this.disposed) return
        this.disposed = true
        if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)

        this.renderer.domElement.removeEventListener('click', this.handleCanvasClick)
        this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true)
        this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove, true)

        this.toolManager.dispose()
        this.transformControls.dispose()
        this.handles.forEach((h) => h.dispose())
        this.handles.clear()
        this.cameraHandles.clear()
        this.xrayPass.dispose()
        this.viewCube.dispose()
        this.clearModel()
        this.environmentRig.setEnvironment(Environment.None)

        this.scene.environment = null
        this.studioEnvironment.dispose()
        this.renderer.dispose()
        this.renderer.forceContextLoss()
        this.renderer.domElement.remove()
        this.css2dRenderer.domElement.remove()
    }

    public setActive(active: boolean) {
        if (this.disposed || active === !this.paused) return
        this.paused = !active
        if (!active) {
            if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        } else this.startAnimationLoop()
    }

    public updateTheme(theme: Theme) {
        this.theme = theme
        this.scene.background = theme.background
        this.environmentRig.setTheme(theme)
        this.xrayPass.setColor(theme.foreground)
        if (this.scene.fog) this.scene.fog.color.copy(theme.fog)
        this.materialManager.setTheme(this.modelGroup, theme, this.viewOptions?.get('modelColor'))
        this.handles.forEach((h) => {
            if (h instanceof CrossSectionRig) h.setTheme(theme)
        })
    }

    public resize(width: number, height: number) {
        if (width === 0 || height === 0) return
        this.renderer.setSize(width, height)
        this.css2dRenderer.setSize(width, height)
        this.xrayPass.setSize(width, height)
        this.cameraHandles.forEach((h) => h.resize(width, height))
        const size = new Vector2(width, height)
        this.handles.forEach((h) => {
            if (h instanceof CrossSectionRig) h.resize(width, height)
            if (h instanceof MeasurementRig) h.setResolution(size)
        })
        this.renderFrame()
    }

    public applySettings(viewOptions: ViewOptionsContext) {
        this.viewOptions = viewOptions
        this.environmentRig.setEnvironment(viewOptions.get('environment'), viewOptions.get('buildPlateOrigin'))
        this.activeCameraRig.setMode(viewOptions.get('camera'))
        this.renderer.shadowMap.enabled = viewOptions.get('shadows')
        this.scene.fog = new FogExp2(this.theme.fog, viewOptions.get('fogDensity'))
        this.materialManager.setTheme(this.modelGroup, this.theme, viewOptions.get('modelColor'))
        this.materialManager.applyToGroup(this.modelGroup, viewOptions)

        // Enable clipping whenever any cross-section plane exists and is visible
        this.renderer.localClippingEnabled = this.handles.size > 0
    }

    public loadModelData(modelContext: ModelContext) {
        const { format, base64Data } = modelContext
        if (!base64Data || !format) {
            this.clearModel()
            return
        }

        const binaryString = window.atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }

        this.clearModel()

        if (format === ModelFormat.CSG) {
            const scene = JSON.parse(new TextDecoder().decode(bytes)) as CsgScene
            if (scene.version !== 1 || !Array.isArray(scene.meshes)) throw new Error('Invalid CSG scene payload.')
            const decode = (text: string) => Uint8Array.from(window.atob(text), (c) => c.charCodeAt(0)).buffer
            for (const data of scene.meshes) {
                const properties = new Float32Array(decode(data.properties))
                const indices = new Uint32Array(decode(data.indices))
                if (data.stride < 3 || data.stride > 8 || properties.length % data.stride || indices.length % 3) throw new Error('Invalid CSG mesh buffers.')
                const count = properties.length / data.stride
                if (indices.some((i) => i >= count)) throw new Error('Invalid CSG triangle index.')
                const positions = new Float32Array(count * 3),
                    colors = new Float32Array(count * 4),
                    defaults = new Float32Array(count)
                let transparent = false
                for (let i = 0; i < count; i++) {
                    positions.set(properties.subarray(i * data.stride, i * data.stride + 3), i * 3)
                    const rgba = data.stride === 8 ? properties.subarray(i * 8 + 3, i * 8 + 7) : [1, 1, 1, 1]
                    colors.set(rgba, i * 4)
                    defaults[i] = data.stride === 8 ? properties[i * 8 + 7] : 1
                    transparent ||= rgba[3] < 1
                }
                const geometry = new BufferGeometry()
                geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
                geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
                geometry.setAttribute('scadDefaultColor', new Float32BufferAttribute(defaults, 1))
                geometry.setIndex(new Uint32BufferAttribute(indices, 1))
                geometry.computeVertexNormals()
                this.modelGroup.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, transparent, flatShading: true, ...studioSurface, fog: false })))
            }
            if (this.viewOptions) this.materialManager.applyToGroup(this.modelGroup, this.viewOptions)
        } else if (format === ModelFormat.ThreeMF) {
            const loader = new ThreeMFLoader()
            try {
                const group = loader.parse(bytes.buffer)
                group.traverse((child) => {
                    if (child instanceof Mesh) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material]
                        materials.forEach((mat) => {
                            if (mat.color) {
                                const hex = mat.color.getHexString().toLowerCase()
                                if (hex === 'f9d72c') mat.userData.previewThemeColor = 'additive'
                                else if (hex === '9dcb51') mat.userData.previewThemeColor = 'subtractive'
                                if (mat.userData.previewThemeColor) Object.assign(mat, studioSurface)
                            }
                        })
                        if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals()
                        if (this.viewOptions) this.materialManager.applyToGroup(group, this.viewOptions)
                    }
                })
                this.modelGroup.add(group)
            } catch (e) {
                console.error('Failed to parse 3MF:', e)
            }
        } else {
            const loader = new STLLoader()
            try {
                const geometry = loader.parse(bytes.buffer)
                const material = new MeshStandardMaterial({
                    color: this.theme.additive,
                    flatShading: false,
                    ...studioSurface,
                    fog: false,
                })
                material.userData.previewThemeColor = 'additive'
                const mesh = new Mesh(geometry, material)
                this.modelGroup.add(mesh)
                if (this.viewOptions) this.materialManager.applyToGroup(this.modelGroup, this.viewOptions)
            } catch (e) {
                console.error('Failed to parse STL:', e)
            }
        }

        this.materialManager.setTheme(this.modelGroup, this.theme, this.viewOptions?.get('modelColor'))

        // Pick an absorption coefficient so a ray traversing the model's full
        // diagonal in material reads as ~95% opaque (1 - exp(-3) ≈ 0.95).
        const bounds = new Box3().setFromObject(this.modelGroup)
        this.updateLightShadows(bounds)
        if (bounds.isEmpty()) {
            this.xrayPass.setAbsorption(0)
        } else {
            const diagonal = bounds.getSize(new Vector3()).length()
            this.xrayPass.setAbsorption(diagonal > 0 ? 3 / diagonal : 0)
        }

        // Rebuild cross-section stencils for updated geometry, then reapply all clip planes
        this.handles.forEach((h) => {
            if (h instanceof CrossSectionRig) h.rebuildForModel(this.modelGroup)
        })
        this.rebuildModelClipping()
        this.fitInitialModelIfReady()
    }

    private clearModel() {
        this.modelGroup.traverse((child) => {
            if (!(child instanceof Mesh)) return
            child.geometry.dispose()
            const materials = Array.isArray(child.material) ? child.material : [child.material]
            for (const material of materials) material.dispose()
        })
        this.modelGroup.clear()
    }

    /** Scene hydration decides whether to restore a saved pose or fit the first model. */
    public initializeView(hasSavedCamera: boolean): void {
        this.fitInitialModel = !hasSavedCamera
        this.fitInitialModelIfReady()
    }

    private fitInitialModelIfReady(): void {
        if (!this.fitInitialModel || new Box3().setFromObject(this.modelGroup).isEmpty()) return
        this.fitInitialModel = false
        this.resetView(0, new Vector3(-1, -1, 1))
    }

    public resetView(duration = 420, direction?: Vector3): void {
        const modelBounds = new Box3().setFromObject(this.modelGroup)
        const bounds = this.viewOptions?.is('environment', Environment.BuildPlate) ? buildPlateResetBounds(modelBounds, this.viewOptions.get('buildPlateOrigin')) : modelBounds
        this.activeCameraRig.resetView(bounds, duration, direction)
        if (this.selectedId === this.activeCameraRig.id) this.onPropertiesChange?.(this.activeCameraRig.getProperties())
        this.onPersist?.()
    }

    public clearMeasurements(): void {
        const tool = this.toolManager.activeTool
        if (tool instanceof MeasureTool) tool.clear()
        for (const [id, handle] of this.handles) {
            if (handle instanceof MeasurementRig) this.removeSceneObject(id)
        }
    }

    // ============= Scene Object Registry =============

    public addSceneObject(type: SceneObjectType, id: string): void {
        let handle: Rig | null = null

        if (type === 'camera') {
            // The default camera is pre-created in the constructor; subsequent cameras
            // (added by the user) get a fresh rig with controls disabled until they
            // become active.
            if (!this.cameraHandles.has(id)) {
                const rig = this.createCameraRig(id)
                rig.getControls().enabled = false
                rig.setVisible(true)
            }
            return
        }

        if (type === 'cross-section-plane') {
            const rig = new CrossSectionRig(id, this.theme.accent)
            this.scene.add(rig.group)
            rig.enable(this.modelGroup)
            this.handles.set(id, rig)
            this.rebuildModelClipping()
            return
        }

        if (type === 'measurement') {
            // Default endpoints — hydrate / Object Properties inputs supply the real
            // coordinates afterwards via setProperty.
            const rig = new MeasurementRig(id, new Vector3(0, 0, 0), new Vector3(10, 0, 0), this.theme.accent)
            this.scene.add(rig.group)
            this.handles.set(id, rig)
            return
        }

        if (type === 'ambient-light') {
            const h = new AmbientLightRig(id, 0.02 * Math.PI)
            this.scene.add(h.light)
            handle = h
        } else if (type === 'directional-light') {
            const h = new DirectionalLightRig(id, 0.4 * Math.PI, -150, -200, 300, this.theme.foreground)
            this.scene.add(h.light)
            handle = h
        } else if (type === 'spot-light') {
            const h = new SpotLightRig(id, 0.04 * Math.PI, 200, 200, 250, 0.6, 1, this.theme.foreground)
            this.scene.add(h.light)
            handle = h
        } else if (type === 'point-light') {
            const h = new PointLightRig(id, 0.04 * Math.PI, -200, 100, 100, 0, this.theme.foreground)
            this.scene.add(h.light)
            handle = h
        }

        if (handle) {
            this.handles.set(id, handle)
            this.updateLightShadows(new Box3().setFromObject(this.modelGroup))
        }
    }

    private updateLightShadows(bounds: Box3): void {
        for (const handle of this.handles.values()) {
            if (handle instanceof DirectionalLightRig) fitDirectionalShadow(handle.light, bounds)
        }
    }

    public removeSceneObject(id: string): void {
        const handle = this.handles.get(id)
        if (!handle) return

        if (this.selectedId === id) this.selectObject(null)

        if (handle instanceof CrossSectionRig) {
            handle.disable()
            this.scene.remove(handle.group)
        } else if (handle instanceof MeasurementRig) {
            this.scene.remove(handle.group)
        } else if (handle instanceof CameraRig) {
            this.scene.remove(handle.getPerspectiveCamera())
            this.cameraHandles.delete(id)
        } else {
            this.scene.remove(handle.getTransformTarget())
        }
        handle.dispose()
        this.handles.delete(id)

        this.rebuildModelClipping()
    }

    public setActiveCamera(id: string): void {
        const handle = this.cameraHandles.get(id)
        if (!handle) return
        this.activeCameraRig.getControls().enabled = false
        this.activeCameraRig.setIsActiveCamera(false)
        this.activeCameraRig = handle
        this.activeCameraRig.getControls().enabled = true
        this.activeCameraRig.setIsActiveCamera(true)
        this.transformControls.camera = this.activeCameraRig.getPerspectiveCamera()
    }

    public selectObject(id: string | null): void {
        // Deselect previous
        if (this.selectedId) {
            const prev = this.handles.get(this.selectedId)
            if (prev) {
                prev.setSelected(false)
                this.transformControls.detach()
            }
        }

        this.selectedId = id

        if (id) {
            const handle = this.handles.get(id)
            if (handle) {
                handle.setSelected(true)
                if (this.gizmoMode !== null && handle.supportsTransform) {
                    this.transformControls.setMode(this.gizmoMode)
                    this.transformControls.attach(handle.getTransformTarget())
                }
                this.onPropertiesChange?.(handle.getProperties())
            }
        } else {
            this.onPropertiesChange?.(null)
        }

        this.onSelectionChange?.(id)
    }

    public setObjectVisible(id: string, visible: boolean): void {
        const handle = this.handles.get(id)
        if (!handle) return
        handle.setVisible(visible)
        if (visible) handle.onShow()
        else handle.onHide()
    }

    public setObjectActive(id: string, active: boolean): void {
        const handle = this.handles.get(id)
        if (!handle) return
        handle.setActive(active)
        this.rebuildModelClipping()
    }

    private rebuildModelClipping(): void {
        const planes: Plane[] = []
        for (const handle of this.handles.values()) {
            if (handle instanceof CrossSectionRig && handle.active) {
                planes.push(handle.plane)
            }
        }

        // Apply all active planes to every model mesh, and place the model between
        // tier 0 and tier 1 so all caps except tier 0 can depth-test against it.
        this.modelGroup.traverse((child) => {
            if (!(child instanceof Mesh)) return
            const mats = Array.isArray(child.material) ? child.material : [child.material]
            for (const mat of mats) {
                mat.clippingPlanes = [...planes]
                mat.needsUpdate = true
            }
            child.renderOrder = planes.length > 0 ? MODEL_CLIP_RENDER_ORDER : 0
        })

        this.xrayPass.setClippingPlanes(planes)

        // Assign isolated render-order tiers so each rig's stencil→cap cycle
        // completes before the next rig's stencil writes begin.
        this.reassignTiers()

        // Clip each cap by every other rig's plane so caps don't bleed into
        // geometry that a sibling plane has cut away.
        for (const handle of this.handles.values()) {
            if (handle instanceof CrossSectionRig && handle.visible) {
                handle.setCapClippingPlanes(planes.filter((p) => p !== handle.plane))
            }
        }

        this.renderer.localClippingEnabled = planes.length > 0
    }

    private reassignTiers(): void {
        let index = 0
        for (const handle of this.handles.values()) {
            if (handle instanceof CrossSectionRig && handle.active) {
                handle.setTierIndex(index++)
            }
        }
    }

    public setObjectProperty(id: string, key: string, value: number): void {
        const handle = this.handles.get(id)
        handle?.setProperty(key, value)
        if (handle instanceof DirectionalLightRig) fitDirectionalShadow(handle.light, new Box3().setFromObject(this.modelGroup))
    }

    /**
     * Returns a snapshot of every handle's current properties, keyed by id.
     * Used by App to build the persisted scene snapshot.
     */
    public serializeProperties(): Map<string, ObjectProperties> {
        const out = new Map<string, ObjectProperties>()
        for (const [id, handle] of this.handles) {
            out.set(id, handle.getProperties())
        }
        return out
    }

    public captureCameraViews(): Map<string, CameraViewState> {
        return new Map([...this.cameraHandles].map(([id, camera]) => [id, camera.captureView()]))
    }

    public restoreCameraViews(views: Map<string, CameraViewState>): void {
        for (const [id, view] of views) this.cameraHandles.get(id)?.restoreView(view)
    }

    // ============= Callbacks from Preview (bridge to Lit contexts) =============

    public setSelectionCallbacks(onSelectionChange: (id: string | null) => void, onPropertiesChange: (props: ObjectProperties | null) => void): void {
        this.onSelectionChange = onSelectionChange
        this.onPropertiesChange = onPropertiesChange
    }

    public setObjectRegisteredCallback(cb: (id: string, type: SceneObjectType) => void): void {
        this.onObjectRegistered = cb
    }

    /**
     * Register a callback that fires when persistable scene state changes via a
     * channel that doesn't already flow through the scene/selected-object
     * contexts — currently just TrackballControls movements on any camera.
     */
    public setPersistCallback(cb: () => void): void {
        this.onPersist = cb
    }

    private createCameraRig(id: string): CameraRig {
        const size = this.renderer.getSize(new Vector2())
        const rig = new CameraRig(id, size.x, size.y, this.renderer.domElement, this.theme.foreground)
        rig.getControls().addEventListener('change', () => this.onPersist?.())
        this.cameraHandles.set(id, rig)
        this.handles.set(id, rig)
        this.scene.add(rig.getPerspectiveCamera())
        return rig
    }

    /**
     * Register a rig that was created externally (e.g. by a tool).
     * Adds it to the scene, registers it as a handle, notifies listeners,
     * and selects it.
     */
    public addObject(rig: Rig, type: SceneObjectType): void {
        this.scene.add(rig.getSceneRoot())
        this.handles.set(rig.id, rig)
        this.onObjectRegistered?.(rig.id, type)
        this.selectObject(rig.id)
    }

    // ============= Tool =============

    public setActiveTool(tool: ActiveTool): void {
        this.gizmoMode = tool === ActiveTool.Move ? 'translate' : tool === ActiveTool.Rotate ? 'rotate' : null

        if (this.gizmoMode === null) {
            this.transformControls.detach()
        } else {
            this.transformControls.setMode(this.gizmoMode)
            if (this.selectedId) {
                const handle = this.handles.get(this.selectedId)
                if (handle && handle.supportsTransform) this.transformControls.attach(handle.getTransformTarget())
            }
        }

        const toolInstance = this.getToolInstance(tool)

        this.toolManager.switchTo(toolInstance)
    }

    private getToolInstance(tool: ActiveTool) {
        switch (tool) {
            default:
            case ActiveTool.Select:
                return new SelectTool()
            case ActiveTool.Move:
                return new MoveTool()
            case ActiveTool.Rotate:
                return new RotateTool()
            case ActiveTool.Scale:
                return new ScaleTool()
            case ActiveTool.Measure:
                return new MeasureTool({
                    raycaster: this.raycaster,
                    camera: () => this.activeCameraRig.activeCamera,
                    renderer: this.renderer,
                    css2dRenderer: this.css2dRenderer,
                    modelGroup: this.modelGroup,
                    scene: this.scene,
                    color: this.theme.accent,
                    variant: () => this.toolVariant,
                    addObject: (rig, type) => this.addObject(rig, type),
                })
        }
    }

    public setToolVariant(variant: string | null): void {
        this.toolVariant = variant
    }

    // ============= Animation loop =============

    private startAnimationLoop = () => {
        if (this.paused || this.disposed) return
        this.animationFrameId = requestAnimationFrame(this.startAnimationLoop)
        this.activeCameraRig.update()
        this.viewCube.update(this.activeCameraRig.activeCamera)
        const cam = this.activeCameraRig.getPerspectiveCamera()
        this.environmentRig.updateCamera(cam.position.distanceTo(this.activeCameraRig.getControls().target))
        this.handles.forEach((h) => {
            if (h instanceof CrossSectionRig) h.update()
        })
        // Camera position/rotation change every frame while orbiting — keep the
        // properties panel in sync if a camera is currently selected.
        if (this.selectedId) {
            const handle = this.handles.get(this.selectedId)
            if (handle instanceof CameraRig) {
                this.onPropertiesChange?.(handle.getProperties())
            }
        }
        this.renderFrame()
        this.css2dRenderer.render(this.scene, this.activeCameraRig.activeCamera)
    }

    private renderFrame() {
        if (this.paused || this.disposed) return
        const camera = this.activeCameraRig.activeCamera

        if (this.viewOptions?.is('renderMode', RenderMode.XRay)) {
            // Hide the model from the main pass so the environment/grid render
            // unoccluded, then accumulate thickness from the model alone and
            // composite that on top with density-driven opacity.
            const modelVisible = this.modelGroup.visible
            this.modelGroup.visible = false
            this.renderer.render(this.scene, camera)
            this.modelGroup.visible = modelVisible
            this.xrayPass.render(this.renderer, this.modelGroup, camera)
            return
        }

        this.renderer.render(this.scene, camera)
    }

    // ============= Input handlers =============

    private handleCanvasClick = (e: MouseEvent) => {
        const dx = e.clientX - this.pointerDownX
        const dy = e.clientY - this.pointerDownY
        if (dx * dx + dy * dy > 9) return

        if (this.toolManager.activeTool?.capturesClick) return

        const rect = this.renderer.domElement.getBoundingClientRect()
        const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)

        // Check if gizmo consumed the click
        if (this.gizmoJustInteracted) return

        // Raycast against all registered handles
        const selectables: { id: string; obj: import('three').Object3D }[] = []
        for (const [id, handle] of this.handles) {
            for (const obj of handle.getSelectableObjects()) {
                selectables.push({ id, obj })
            }
        }

        this.raycaster.setFromCamera(ndc, this.activeCameraRig.activeCamera)
        const hits = this.raycaster.intersectObjects(
            selectables.map((s) => s.obj),
            false,
        )
        const hitId = hits.length > 0 ? (selectables.find((s) => s.obj === hits[0].object)?.id ?? null) : null

        this.selectObject(hitId)
    }

    private handlePointerDown = (e: PointerEvent) => {
        this.pointerDownX = e.clientX
        this.pointerDownY = e.clientY
    }

    private handlePointerMove = (e: PointerEvent) => {
        this.snapEnabled = e.ctrlKey
        this.transformControls.setTranslationSnap(this.snapEnabled ? TRANSLATION_SNAP : null)
        this.transformControls.setRotationSnap(this.snapEnabled ? ROTATION_SNAP : null)
    }
}
