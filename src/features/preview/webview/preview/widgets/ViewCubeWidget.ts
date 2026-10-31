import { ArrowHelper, Group, Sprite, SpriteMaterial, Camera, CanvasTexture, Color, EdgesGeometry, LineBasicMaterial, LineSegments, Material, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3 } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { createCubeRegions, cubeRegionGeometry, cubeLabelQuaternion, CubeRegion } from './ViewCubeGeometry'

import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { Line2NodeMaterial as LineMaterial } from 'three/webgpu'

import { AXIS_COLORS } from './AxisColors'

type RegionMesh = Mesh<ReturnType<typeof cubeRegionGeometry>, MeshBasicMaterial>

/** A Z-up view cube whose bevels are real, separately selectable surfaces. */
export class ViewCubeWidget {
    private readonly scene = new Scene()
    private readonly camera = new OrthographicCamera(-2.4, 2.4, 2.4, -2.4, 0.1, 20)
    private readonly renderer = new WebGPURenderer({
        antialias: true,
        alpha: true,
    })
    public readonly ready = this.renderer.init().then(() => {
        this.initialized = true
    })
    private initialized = false
    private readonly raycaster = new Raycaster()
    private readonly regions: RegionMesh[] = []
    private readonly textures: CanvasTexture[] = []
    private readonly labels: Mesh<PlaneGeometry, MeshBasicMaterial>[] = []
    private readonly borders: LineSegments<EdgesGeometry, LineBasicMaterial>[] = []
    private readonly rollControls = document.createElement('div')
    private readonly axes = new Group()
    private readonly axisArrows: ArrowHelper[] = []
    private readonly axisLines: Line2[] = []
    private readonly axisLabels: Sprite[] = []
    private hovered: RegionMesh | undefined
    private pointerDown: { x: number; y: number } | undefined
    private themeObserver: MutationObserver
    private faceColor = new Color()
    private edgeColor = new Color()
    private hoverColor = new Color()
    private disposed = false

    constructor(
        container: HTMLElement,
        private readonly onSelect: (direction: Vector3, kind: CubeRegion['kind']) => void,
        onRoll: (angle: number) => void,
    ) {
        const canvas = this.renderer.domElement
        this.renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 2), 3))
        this.renderer.setSize(192, 192)
        canvas.classList.add('view-cube')
        canvas.setAttribute('aria-label', 'View cube. Click a face, edge or corner to orient the camera.')
        canvas.style.cssText = 'position:absolute;bottom:1rem;right:1rem;width:192px;height:192px;touch-action:none;border-radius:4px;'
        canvas.title = 'View cube — select a face, edge or corner'
        container.appendChild(canvas)
        this.rollControls.style.cssText = 'position:absolute;bottom:calc(1rem + 160px);right:1rem;display:none;gap:4px;'
        this.rollControls.setAttribute('role', 'group')
        this.rollControls.setAttribute('aria-label', 'View roll')
        for (const [text, label, angle] of [
            ['↶', 'Roll counterclockwise 90°', -Math.PI / 2],
            ['↷', 'Roll clockwise 90°', Math.PI / 2],
        ] as const) {
            const button = document.createElement('button')
            button.textContent = text
            button.title = label
            button.setAttribute('aria-label', label)
            button.style.cssText = 'width:24px;height:24px;padding:0;border:1px solid var(--vscode-panel-border,#555);border-radius:5px;background:var(--vscode-editorWidget-background,#252526);color:var(--vscode-foreground,#ccc);font:20px sans-serif;cursor:pointer;'
            button.addEventListener('pointerdown', (event) => event.stopPropagation())
            button.addEventListener('click', (event) => {
                event.stopPropagation()
                onRoll(angle)
            })
            this.rollControls.appendChild(button)
        }
        container.appendChild(this.rollControls)

        for (const region of createCubeRegions()) {
            const mesh = new Mesh(cubeRegionGeometry(region), new MeshBasicMaterial())
            mesh.userData.region = region
            this.regions.push(mesh)
            this.scene.add(mesh)
            const border = new LineSegments(new EdgesGeometry(mesh.geometry), new LineBasicMaterial())
            this.borders.push(border)
            this.scene.add(border)
            if (region.kind === 'face') this.addLabel(region)
        }
        this.addAxes()
        this.updateTheme()
        this.themeObserver = new MutationObserver(() => this.updateTheme())
        this.themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-vscode-theme', 'data-vscode-theme-kind'],
        })
        canvas.addEventListener('pointermove', this.onPointerMove)
        canvas.addEventListener('pointerleave', this.onPointerLeave)
        canvas.addEventListener('pointerdown', this.onPointerDown)
        canvas.addEventListener('pointercancel', this.onPointerLeave)
        canvas.addEventListener('click', this.onClick)
    }

    private addAxes() {
        // Offset outward from Left–Front–Bottom so the full shaft width clears the cube.
        // The 0.1 gap is 5% of the cube edge; axis lengths remain unchanged.
        this.axes.position.set(-1.1, -1.1, -1.1)
        for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
            const direction = new Vector3().setComponent(index, 1)
            const color = AXIS_COLORS[axis]
            const arrow = new ArrowHelper(direction, new Vector3(), 2, color, 0.24, 0.14)
            // Native WebGL lines cannot reliably render wider than one pixel.
            arrow.line.visible = false
            const geometry = new LineGeometry()
            const shaftEnd = direction.clone().multiplyScalar(2 - 0.24)
            geometry.setPositions([0, 0, 0, ...shaftEnd.toArray()])
            const line = new Line2(
                geometry,
                new LineMaterial({
                    color,
                    linewidth: 2,
                    worldUnits: false,
                    depthTest: true,
                    toneMapped: false,
                }),
            )
            line.renderOrder = 2
            line.frustumCulled = false
            this.axisLines.push(line)
            this.axes.add(line)
            ;(arrow.cone.material as Material).depthTest = true
            arrow.line.renderOrder = arrow.cone.renderOrder = 2
            this.axisArrows.push(arrow)
            this.axes.add(arrow)
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 128
            const ctx = canvas.getContext('2d')!
            ctx.fillStyle = `#${new Color(color).getHexString()}`
            ctx.font = '600 96px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(axis.toUpperCase(), 64, 64)
            const texture = new CanvasTexture(canvas)
            texture.colorSpace = SRGBColorSpace
            this.textures.push(texture)
            const label = new Sprite(
                new SpriteMaterial({
                    map: texture,
                    depthTest: true,
                    depthWrite: false,
                    toneMapped: false,
                }),
            )
            label.position.copy(direction).multiplyScalar(2.25)
            label.scale.setScalar(0.32)
            label.renderOrder = 3
            this.axisLabels.push(label)
            this.axes.add(label)
        }
        this.scene.add(this.axes)
    }

    private addLabel(region: CubeRegion) {
        const canvas = document.createElement('canvas')
        canvas.width = 1024
        canvas.height = 1024
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 1
        this.textures.push(texture)
        const label = new Mesh(
            new PlaneGeometry(1.5, 1.5),
            new MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                toneMapped: false,
            }),
        )
        const normal = region.direction
        label.position.copy(normal).multiplyScalar(1.002)
        label.quaternion.copy(cubeLabelQuaternion(normal))
        label.userData.region = region
        this.labels.push(label)
        this.scene.add(label)
    }

    private updateTheme() {
        const style = getComputedStyle(document.body)
        const css = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
        const background = new Color(css('--vscode-editor-background', '#1e1e1e'))
        const foreground = new Color(css('--vscode-editor-foreground', css('--vscode-foreground', '#cccccc')))
        // Match the model's foreground-based rendering on dark editor backgrounds.
        const dark = background.r * 0.299 + background.g * 0.587 + background.b * 0.114 < 0.5
        this.faceColor.set(dark ? foreground : css('--vscode-editorWidget-background', '#f3f3f3'))
        this.edgeColor.copy(this.faceColor).lerp(dark ? background : foreground, 0.15)
        this.hoverColor.set(css('--vscode-focusBorder', '#007fd4')).lerp(this.faceColor, 0.55)
        const border = dark ? this.faceColor.clone().lerp(background, 0.45) : new Color(css('--vscode-widget-border', css('--vscode-panel-border', '#a0a0a0')))
        const labelColor = dark ? background.getStyle() : foreground.getStyle()
        for (const line of this.borders) line.material.color.set(border)
        this.paintRegions()
        for (const label of this.labels) {
            const region = label.userData.region as CubeRegion
            const texture = label.material.map as CanvasTexture
            const canvas = texture.image as HTMLCanvasElement
            const ctx = canvas.getContext('2d')
            if (!ctx) continue
            ctx.clearRect(0, 0, 1024, 1024)
            ctx.fillStyle = labelColor
            ctx.font = `600 256px ${css('--vscode-font-family', 'sans-serif')}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(region.label, 512, 512, 928)
            texture.needsUpdate = true
        }
    }

    private paintRegions() {
        for (const mesh of this.regions) mesh.material.color.copy(mesh === this.hovered ? this.hoverColor : (mesh.userData.region as CubeRegion).kind === 'face' ? this.faceColor : this.edgeColor)
    }

    private pick(event: MouseEvent): RegionMesh | undefined {
        const rect = this.renderer.domElement.getBoundingClientRect()
        const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, (-(event.clientY - rect.top) / rect.height) * 2 + 1)
        this.raycaster.setFromCamera(pointer, this.camera)
        return this.raycaster.intersectObjects(this.regions, false)[0]?.object as RegionMesh | undefined
    }

    private onPointerMove = (event: PointerEvent) => {
        this.hovered = this.pick(event)
        this.renderer.domElement.style.cursor = this.hovered ? 'pointer' : 'default'
        const region = this.hovered?.userData.region as CubeRegion | undefined
        this.renderer.domElement.title = region ? `${region.label} view` : 'View cube — select a face, edge or corner'
        this.paintRegions()
    }

    private onPointerLeave = () => {
        this.hovered = undefined
        this.pointerDown = undefined
        this.renderer.domElement.style.cursor = 'default'
        this.paintRegions()
    }

    private onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        event.stopPropagation()
        this.pointerDown = { x: event.clientX, y: event.clientY }
    }

    private onClick = (event: MouseEvent) => {
        event.stopPropagation()
        const start = this.pointerDown
        this.pointerDown = undefined
        if (event.button !== 0 || !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
        const region = this.pick(event)?.userData.region as CubeRegion | undefined
        if (region) this.onSelect(region.direction.clone(), region.kind)
    }

    update(mainCamera: Camera) {
        if (!this.initialized || this.disposed) return
        // Copy rotation, including roll, instead of lookAt at the Z-up poles.
        this.camera.quaternion.copy(mainCamera.quaternion)
        this.camera.position.set(0, 0, 6).applyQuaternion(mainCamera.quaternion)
        this.camera.updateMatrixWorld()
        const facing = new Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion)
        // Hide end-on axes to keep the corner coordinate frame readable.
        for (let axis = 0; axis < 3; axis++) {
            const projectedLength = Math.sqrt(Math.max(0, 1 - facing.getComponent(axis) ** 2))
            this.axisArrows[axis].visible = projectedLength > 0.35
            this.axisLines[axis].visible = projectedLength > 0.35
            this.axisLabels[axis].visible = projectedLength > 0.55
        }
        this.rollControls.style.display = Math.max(Math.abs(facing.x), Math.abs(facing.y), Math.abs(facing.z)) > 1 - 1e-5 ? 'flex' : 'none'
        for (const label of this.labels) {
            const normal = (label.userData.region as CubeRegion).direction
            // Hide back faces and nearly edge-on text instead of showing slivers.
            label.visible = normal.dot(facing) > 0.03
        }
        this.renderer.render(this.scene, this.camera)
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.themeObserver.disconnect()
        const canvas = this.renderer.domElement
        canvas.removeEventListener('pointermove', this.onPointerMove)
        canvas.removeEventListener('pointerleave', this.onPointerLeave)
        canvas.removeEventListener('pointerdown', this.onPointerDown)
        canvas.removeEventListener('pointercancel', this.onPointerLeave)
        canvas.removeEventListener('click', this.onClick)
        for (const mesh of [...this.regions, ...this.labels]) {
            mesh.geometry.dispose()
            mesh.material.dispose()
        }
        for (const line of this.borders) {
            line.geometry.dispose()
            line.material.dispose()
        }
        for (const arrow of this.axisArrows) arrow.dispose()
        for (const line of this.axisLines) {
            line.geometry.dispose()
            line.material.dispose()
        }
        for (const label of this.axisLabels) label.material.dispose()
        for (const texture of this.textures) texture.dispose()
        this.renderer.dispose()

        this.rollControls.remove()
        canvas.remove()
    }
}
