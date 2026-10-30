import { ExtensionToWebviewMessage } from '../../shared/types/ExtensionToWebviewMessage'
import type { PreviewMode } from '../../shared/types/PreviewMode'

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

    constructor(
        private readonly post = nativePost,
        native = true,
    ) {
        if (native) window.addEventListener('message', this.handleMessage)
    }

    public dispose() {
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
        this.callbacks.forEach((cb) => cb(message))
    }
}

// Export a singleton instance
export const bridge = new Bridge()
