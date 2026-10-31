import type { PreviewTimings } from '../../shared/types/PreviewBackend'
import type { CsgClipPlane } from '../../../../core/csg/types'
import { ExtensionToWebviewMessage } from '../../shared/types/ExtensionToWebviewMessage'
import type { PreviewMode } from '../../shared/types/PreviewMode'
import type { CsgGeometry } from '../../../../core/csg/types'

let vscode: ReturnType<typeof acquireVsCodeApi> | undefined
const nativePost = (message: unknown) => {
    ;(vscode ??= acquireVsCodeApi()).postMessage(message)
}

export type MessageCallback = (message: ExtensionToWebviewMessage) => void

/**
 * Bridge handles all incoming messages from the VS Code extension host
 * and provides a centralized way to send messages back.
 */
export class Bridge {
    private callbacks: Set<MessageCallback> = new Set()
    private topology = new Map<number, { resolve: (geometry: CsgGeometry) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

    constructor(
        private readonly post = nativePost,
        native = true,
    ) {
        if (native) window.addEventListener('message', this.handleMessage)
    }

    public dispose() {
        for (const pending of this.topology.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error('Preview closed.'))
        }
        this.topology.clear()
        window.removeEventListener('message', this.handleMessage)
        this.callbacks.clear()
    }

    public onMessage(callback: MessageCallback) {
        this.callbacks.add(callback)
        return () => this.callbacks.delete(callback)
    }

    public ready() {
        this.post({ type: 'ready' })
    }

    public setPreviewMode(mode: PreviewMode) {
        this.post({ type: 'setPreviewMode', mode })
    }

    public queryTopology(modelVersion: number, planes?: CsgClipPlane[]): Promise<CsgGeometry> {
        return new Promise((resolve, reject) => {
            if (this.topology.has(modelVersion)) {
                reject(new Error('Topology is already being prepared.'))
                return
            }
            const timer = setTimeout(() => {
                this.topology.delete(modelVersion)
                reject(new Error('Topology request timed out.'))
            }, 35000)
            this.topology.set(modelVersion, { resolve, reject, timer })
            this.post({ type: 'queryTopology', modelVersion, planes })
        })
    }

    public reportPerformance(modelVersion: number, timings: PreviewTimings) {
        this.post({ type: 'previewPerformance', modelVersion, timings })
    }

    public frameReady(modelVersion: number, graphics: 'webgpu' | 'webgl2', elapsedMs: number) {
        this.post({ type: 'frameReady', modelVersion, graphics, elapsedMs })
    }

    public updateParameterOverride(name: string, value: string | number | boolean | number[] | undefined) {
        this.post({ type: 'parameterChanged', name, value })
    }

    public saveParameterSet(name: string) {
        this.post({ type: 'saveParameterSet', name })
    }

    public promptSaveParameterSet() {
        this.post({ type: 'promptSaveParameterSet' })
    }

    public deleteParameterSet(name: string) {
        this.post({ type: 'deleteParameterSet', name })
    }

    public applyParameterSet(name: string | undefined) {
        this.post({ type: 'applyParameterSet', name })
    }

    public exportModel() {
        this.post({ type: 'exportModel' })
    }

    public sendToSlicer() {
        this.post({ type: 'sendToSlicer' })
    }

    public persistScene(snapshot: unknown) {
        this.post({ type: 'persistScene', snapshot })
    }

    public reportError(error: unknown) {
        console.error('[OpenSCAD Preview]', error)
        this.post({
            type: 'error',
            message: error?.toString(),
        })
    }

    private handleMessage = (event: MessageEvent) => {
        this.receive(event.data as ExtensionToWebviewMessage)
    }

    public receive(message: ExtensionToWebviewMessage) {
        if (message.type === 'topology') {
            const pending = this.topology.get(message.modelVersion)
            if (pending) {
                clearTimeout(pending.timer)
                this.topology.delete(message.modelVersion)
                if (message.geometry) pending.resolve(message.geometry)
                else pending.reject(new Error(message.error ?? 'Topology preparation failed.'))
            }
        }
        if (message.type === 'update' || message.type === 'emptyModel' || message.type === 'renderError') {
            for (const [version, pending] of this.topology) {
                if (message.type !== 'update' || version !== message.modelVersion) {
                    clearTimeout(pending.timer)
                    pending.reject(new Error('Model changed.'))
                    this.topology.delete(version)
                }
            }
        }
        this.callbacks.forEach((cb) => cb(message))
    }
}

// Export a singleton instance
export const bridge = new Bridge()
