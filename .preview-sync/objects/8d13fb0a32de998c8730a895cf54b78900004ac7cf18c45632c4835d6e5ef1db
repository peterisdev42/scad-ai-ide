import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'

/** Convert CSS pixel dragging to a translation on the orbit target's view plane. */
export function viewportPanDelta(camera: PerspectiveCamera | OrthographicCamera, target: Vector3, dx: number, dy: number, width: number, height: number): Vector3 {
    const spanY = camera instanceof PerspectiveCamera ? 2 * camera.position.distanceTo(target) * Math.tan(MathUtils.degToRad(camera.fov / 2)) : (camera.top - camera.bottom) / camera.zoom
    const spanX = camera instanceof PerspectiveCamera ? spanY * camera.aspect : (camera.right - camera.left) / camera.zoom
    return new Vector3(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .multiplyScalar((-dx * spanX) / Math.max(width, 1))
        .addScaledVector(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), (dy * spanY) / Math.max(height, 1))
}

/** Fixed angular gain in CSS pixels, independent of viewport dimensions and FOV. */
export const ORBIT_RADIANS_PER_PIXEL = MathUtils.degToRad(0.4)

/** Z-up turntable orbit, with a stable heading even at exact Top/Bottom views. */
export function viewportOrbit(camera: PerspectiveCamera, target: Vector3, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return
    const offset = camera.position.clone().sub(target)
    const distance = offset.length()
    if (distance < 1e-10) return
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const azimuth = (Math.hypot(offset.x, offset.y) > distance * 1e-8 ? Math.atan2(offset.y, offset.x) : Math.atan2(-right.x, right.y)) - dx * ORBIT_RADIANS_PER_PIXEL
    const elevation = MathUtils.clamp(Math.asin(MathUtils.clamp(offset.z / distance, -1, 1)) + dy * ORBIT_RADIANS_PER_PIXEL, -Math.PI / 2, Math.PI / 2)
    const cosElevation = Math.cos(elevation)
    camera.position
        .set(cosElevation * Math.cos(azimuth), cosElevation * Math.sin(azimuth), Math.sin(elevation))
        .multiplyScalar(distance)
        .add(target)
    // Recover world-up on drag instead of accumulating roll from mixed movements.
    camera.up.set(-Math.sin(elevation) * Math.cos(azimuth), -Math.sin(elevation) * Math.sin(azimuth), cosElevation)
    camera.lookAt(target)
}

/** Turntable mouse orbit and exact screen-space panning, consuming every input sample. */
export class DirectPointerNavigation {
    private drag?: {
        pointerId: number
        x: number
        y: number
        mode: 'pan' | 'rotate'
    }
    private disposed = false

    constructor(
        private readonly controls: TrackballControls,
        private readonly camera: PerspectiveCamera,
        private readonly activeCamera: () => PerspectiveCamera | OrthographicCamera,
        private readonly element: HTMLElement,
    ) {
        this.element.addEventListener('pointerdown', this.onDown, true)
        this.element.addEventListener('pointermove', this.onMove, true)
        this.element.addEventListener('pointerup', this.onEnd, true)
        this.element.addEventListener('pointercancel', this.onEnd, true)
        this.element.addEventListener('lostpointercapture', this.onEnd, true)
    }

    private onDown = (event: PointerEvent) => {
        if (!this.controls.enabled) return
        this.controls.handleResize()
        if (event.pointerType === 'touch' || (event.button !== 0 && event.button !== 2)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (this.drag) return
        this.drag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            mode: event.button === 2 || event.shiftKey || event.ctrlKey || event.metaKey ? 'pan' : 'rotate',
        }
        this.element.setPointerCapture(event.pointerId)
        this.controls.dispatchEvent({ type: 'start' })
    }

    private onMove = (event: PointerEvent) => {
        if (this.drag?.pointerId === event.pointerId) {
            event.preventDefault()
            event.stopImmediatePropagation()
            const dx = event.clientX - this.drag.x
            const dy = event.clientY - this.drag.y
            this.drag.x = event.clientX
            this.drag.y = event.clientY
            if (!this.controls.enabled) return
            if (this.drag.mode === 'rotate') {
                viewportOrbit(this.camera, this.controls.target, dx, dy)
            } else {
                const rect = this.element.getBoundingClientRect()
                const delta = viewportPanDelta(this.activeCamera(), this.controls.target, dx, dy, rect.width, rect.height)
                this.camera.position.add(delta)
                this.controls.target.add(delta)
            }
            this.controls.update()
            return
        }
        // Keep the remaining native touch/middle-button controls responsive as well.
        queueMicrotask(() => {
            if (!this.disposed && this.controls.enabled && !this.drag) this.controls.update()
        })
    }

    private onEnd = (event: PointerEvent) => {
        if (this.drag?.pointerId !== event.pointerId) return
        event.stopImmediatePropagation()
        const pointerId = this.drag.pointerId
        this.drag = undefined
        if (this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId)
        this.controls.dispatchEvent({ type: 'end' })
    }

    dispose() {
        this.disposed = true
        const pointerId = this.drag?.pointerId
        this.drag = undefined
        if (pointerId !== undefined && this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId)
        this.element.removeEventListener('pointerdown', this.onDown, true)
        this.element.removeEventListener('pointermove', this.onMove, true)
        this.element.removeEventListener('pointerup', this.onEnd, true)
        this.element.removeEventListener('pointercancel', this.onEnd, true)
        this.element.removeEventListener('lostpointercapture', this.onEnd, true)
    }
}
