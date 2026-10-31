import type { CsgClipPlane, CsgGeometry } from '../../../core/csg/types'
import '@vscode-elements/elements'
import { App } from './components/App'
import { Bridge } from './services/Bridge'
import type { PreviewModel } from '../shared/types/PreviewModel'
import type { SceneSnapshot } from './contexts/SceneContext'
import type { CameraViewState } from './preview/rigs/CameraRig'

const key = Symbol.for('scad-ai-ide.markdown.viewer.v2.blas')
const host = window as unknown as Record<symbol, unknown>
host[key] = {
    mount(container: HTMLElement, model: PreviewModel, saved?: { scene?: SceneSnapshot; cameras?: Map<string, CameraViewState> }) {
        const transport = (window as unknown as Record<symbol, unknown>)[Symbol.for('scad-ai-ide.markdown.host')] as {setPreviewMode:(blockId:string,modelVersion:number,mode:'preview'|'render')=>void; queryTopology: (blockId: string, version: number, planes?: CsgClipPlane[]) => Promise<CsgGeometry>; disposeBlock: (blockId: string, version: number) => void } | undefined
        const app = new App()
        app.setAttribute('embedded', '')
        app.modelContext = { ...app.modelContext, exportEnabled: false }
        let active = true
        let backend = model.backend ?? { kind: model.format === 'csg' ? ('csg' as const) : ('mesh' as const), reason: model.note }
        let scene = saved?.scene
        let cameras = saved?.cameras
        const bridge = new Bridge((raw) => {
            const message = raw as { type: string; snapshot?: SceneSnapshot; modelVersion?: number; planes?: import('../../../core/csg/types').CsgClipPlane[] }
            if (message.type === 'ready')
                queueMicrotask(() => {
                    bridge.receive({type:'previewMode',mode:model.previewMode??(model.format==='csg'?'preview':'render'),links:model.modeLinks})
                    bridge.receive({ type: 'loadScene', snapshot: scene ?? null })
                    bridge.receive({ type: 'previewBackend', backend })
                    bridge.receive({ type: 'update', format: model.format, content: model.content, modelVersion: model.host?.modelVersion ?? 0 })
                    if (model.note) bridge.receive({ type: 'log', message: model.note })
                })
            if(message.type==='setPreviewMode'){
                const mode=(raw as {mode:'preview'|'render'}).mode
                if(transport&&model.host)transport.setPreviewMode(model.host.blockId,model.host.modelVersion,mode)
                else if(model.modeLinks?.[mode]){
                    bridge.receive({type:'loadingState',loading:true,message:'Switching preview mode…'})
                }else bridge.receive({type:'previewIssue',message:'The Markdown host did not provide a preview mode transport.'})
            }
            if (message.type === 'previewPerformance') {
                const { timings } = raw as { timings: import('../shared/types/PreviewBackend').PreviewTimings }
                backend = { ...backend, timings: { ...backend.timings, ...timings } }
                bridge.receive({ type: 'previewBackend', backend })
            }
            if (message.type === 'persistScene') scene = message.snapshot
            if (message.type === 'frameReady') {
                const frame = raw as { graphics: 'webgpu' | 'webgl2'; elapsedMs: number }
                backend = { ...backend, graphics: frame.graphics, firstFrameMs: frame.elapsedMs, frameReady: true }
                bridge.receive({ type: 'previewBackend', backend })
            }
            if (message.type === 'queryTopology') {
                if (transport && model.host) {
                    const target = model.host
                    void transport.queryTopology(target.blockId, target.modelVersion, message.planes).then(
                        (geometry) => bridge.receive({ type: 'topology', modelVersion: target.modelVersion, geometry }),
                        (error) => bridge.receive({ type: 'topology', modelVersion: target.modelVersion, error: error instanceof Error ? error.message : String(error) }),
                    )
                } else bridge.receive({ type: 'topology', modelVersion: message.modelVersion ?? 0, geometry: message.planes?.length ? undefined : model.topology, error: message.planes?.length ? 'Clipped topology is available in Open Markdown Preview with 3D Tools.' : (model.topologyError ?? 'Exact topology is being prepared. The preview will refresh when it is ready.') })
            }
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
            updateModel(next: PreviewModel) {
                const changed = next.format !== model.format || next.content !== model.content || next.host?.modelVersion !== model.host?.modelVersion
                if (changed && model.host) transport?.disposeBlock(model.host.blockId, model.host.modelVersion)
                model = next
                backend = model.backend ?? { kind: model.format === 'csg' ? 'csg' : 'mesh', reason: model.note }
                bridge.receive({type:'previewMode',mode:model.previewMode??(model.format==='csg'?'preview':'render'),links:model.modeLinks})
                bridge.receive({ type: 'previewBackend', backend })
                if (changed) bridge.receive({ type: 'update', format: model.format, content: model.content, modelVersion: model.host?.modelVersion ?? 0 })
                else if (model.topology) void app.updateComplete.then(() => app.shadowRoot?.querySelector('scad-preview')?.stage?.refreshTopology())
            },
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
                if (model.host) transport?.disposeBlock(model.host.blockId, model.host.modelVersion)
                return { scene, cameras }
            },
        }
    },
}
window.dispatchEvent(new Event('scad-markdown-viewer-ready'))
