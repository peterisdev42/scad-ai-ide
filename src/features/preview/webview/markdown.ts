import '@vscode-elements/elements'
import { App } from './components/App'
import { Bridge } from './services/Bridge'
import type { PreviewModel } from '../shared/types/PreviewModel'
import type { SceneSnapshot } from './contexts/SceneContext'
import type { CameraViewState } from './preview/rigs/CameraRig'

const key = Symbol.for('scad-ai-ide.markdown.viewer')
const host = window as unknown as Record<symbol, unknown>
host[key] = {
    mount(container: HTMLElement, model: PreviewModel, saved?: { scene?: SceneSnapshot; cameras?: Map<string, CameraViewState> }) {
        const app = new App()
        app.setAttribute('embedded', '')
        app.modelContext = { ...app.modelContext, exportEnabled: false }
        let active = true
        let scene = saved?.scene
        let cameras = saved?.cameras
        const bridge = new Bridge((raw) => {
            const message = raw as { type: string; snapshot?: SceneSnapshot }
            if (message.type === 'ready')
                queueMicrotask(() => {
                    bridge.receive({ type: 'loadScene', snapshot: scene ?? null })
                    bridge.receive({ type: 'previewBackend', backend: model.backend ?? { kind: model.note ? 'fallback' : model.format === 'csg' ? 'csg' : 'mesh', reason: model.note } })
                    bridge.receive({ type: 'update', format: model.format, content: model.content })
                    if (model.note) bridge.receive({ type: 'log', message: model.note })
                })
            if (message.type === 'persistScene') scene = message.snapshot
        }, false)
        app.bridge = bridge
        app.addEventListener('preview-disconnecting', () => {
            cameras = app.shadowRoot?.querySelector('scad-preview')?.stage?.captureCameraViews()
        })
        app.addEventListener('stage-ready', () => {
            void app.updateComplete.then(() => {
                const stage = app.shadowRoot?.querySelector('scad-preview')?.stage
                stage?.setActive(active)
                if (saved?.cameras) stage?.restoreCameraViews(saved.cameras)
            })
        })
        container.replaceChildren(app)
        return {
            isConnected() {
                return app.isConnected
            },
            setActive(next: boolean) {
                active = next
                app.shadowRoot?.querySelector('scad-preview')?.stage?.setActive(next)
            },
            dispose() {
                if (app.isConnected) {
                    app.saveView()
                    cameras = app.shadowRoot?.querySelector('scad-preview')?.stage?.captureCameraViews()
                }
                app.remove()
                bridge.dispose()
                return { scene, cameras }
            },
        }
    },
}
window.dispatchEvent(new Event('scad-markdown-viewer-ready'))
