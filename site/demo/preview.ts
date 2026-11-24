// Browser host for the same Lit App, Stage and toolbars shipped by the extension.
import '@vscode-elements/elements'
import { App } from '../../src/features/preview/webview/components/App'
import { Bridge } from '../../src/features/preview/webview/services/Bridge'
import { ModelFormat } from '../../src/features/preview/shared/types/ModelFormat'
import type { PreviewBackend } from '../../src/features/preview/shared/types/PreviewBackend'
import type { WebviewToExtensionMessage } from '../../src/features/preview/shared/types/WebviewToExtensionMessage'
import type { SceneSnapshot } from '../../src/features/preview/webview/contexts/SceneContext'

function base64(bytes: Uint8Array): string {
    let raw = ''
    for (let i=0; i<bytes.length; i+=16384) raw += String.fromCharCode(...bytes.subarray(i,i+16384))
    return btoa(raw)
}

export function mountPreview(root: HTMLElement, modelUrl: URL, status: (text: string)=>void) {
    const app = new App()
    app.setAttribute('embedded','')
    app.modelContext = { ...app.modelContext, exportEnabled: false }
    let backend: PreviewBackend = { kind:'mesh', source:'mesh-file', reason:'Bundled STL; no OpenSCAD compiler in this demo.' }
    let active = true, disposed = false
    let snapshot: SceneSnapshot | null = null
    const controller = new AbortController()
    const stage = () => app.shadowRoot?.querySelector('scad-preview')?.stage
    const bridge = new Bridge(raw => {
        if (disposed) return
        const message = raw as WebviewToExtensionMessage
        switch(message.type) {
            case 'ready':
                queueMicrotask(async () => {
                    if (disposed) return
                    bridge.receive({type:'loadScene',snapshot})
                    bridge.receive({type:'previewBackend',backend})
                    bridge.receive({type:'updateParameters',parameters:[],parameterSets:{},activeSetName:undefined,overrides:{}})
                    bridge.receive({type:'loadingState',loading:true,message:'Loading bundled STL…'})
                    root.dataset.previewState='loading'
                    try {
                        const response = await fetch(modelUrl,{signal:controller.signal})
                        if (!response.ok) throw new Error('STL request failed: '+response.status)
                        const bytes = new Uint8Array(await response.arrayBuffer())
                        if (disposed) return
                        bridge.receive({type:'update',format:ModelFormat.STL,content:base64(bytes),modelVersion:1,csgPartsAvailable:false})
                    } catch(error) {
                        if (disposed) return
                        root.dataset.previewState='error'
                        bridge.receive({type:'renderError',message:String(error)})
                    }
                })
                break
            case 'previewPerformance':
                backend={...backend,timings:{...backend.timings,...message.timings}}
                bridge.receive({type:'previewBackend',backend})
                break
            case 'frameReady':
                backend={...backend,graphics:message.graphics,firstFrameMs:message.elapsedMs,frameReady:true}
                bridge.receive({type:'previewBackend',backend})
                root.dataset.previewState='ready'
                root.dataset.graphics=message.graphics
                status(message.graphics==='webgpu'?'WebGPU · STL':'WebGL2 · STL')
                break
            case 'persistScene':
                snapshot=message.snapshot as SceneSnapshot
                break
            case 'queryTopology':
                // Unclipped STL topology is computed inside ModelRepresentation. Native
                // clipped topology needs the extension host and must not be fabricated.
                bridge.receive({type:'topology',modelVersion:message.modelVersion,error:'Exact clipped topology requires the desktop extension.'})
                break
            case 'exportModel':
                { const link=document.createElement('a');link.href=modelUrl.href;link.download='cheese.stl';link.click() }
                break
            case 'error':
                root.dataset.previewState='error'
                status(message.message)
                break
            case 'sendToSlicer':
            case 'openEvidence':
            case 'setPreviewMode':
            case 'parameterChanged':
            case 'saveParameterSet':
            case 'promptSaveParameterSet':
            case 'deleteParameterSet':
            case 'applyParameterSet':
                status('This action requires the desktop extension.')
                break
        }
    },false)
    app.bridge=bridge
    app.addEventListener('stage-ready',()=>stage()?.setActive(active))
    root.replaceChildren(app)
    return {
        setActive(next:boolean){active=next;stage()?.setActive(next)},
        dispose(){disposed=true;controller.abort();app.remove();bridge.dispose()},
    }
}
