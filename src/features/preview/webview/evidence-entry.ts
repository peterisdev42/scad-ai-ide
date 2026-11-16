import { Stage } from './preview/Stage'
import { readPreviewTheme } from './preview/Theme'
import { decodeDisplay, type EvidenceDisplay } from '../../../core/review/display'
import { ModelFormat } from '../shared/types/ModelFormat'
import { CameraMode, Environment, RenderMode, type ViewOptions, type ViewOptionsContext } from './contexts/ViewOptionsContext'
const vscode = acquireVsCodeApi(),
    post = (value: unknown) => vscode.postMessage(value),
    root = document.getElementById('root')!,
    bar = document.createElement('div'),
    canvas = document.createElement('div'),
    status = document.createElement('span'),
    prompt = document.createElement('p'),
    text = document.createElement('textarea'),
    send = document.createElement('button'),
    cancel = document.createElement('button'),
    parts = document.createElement('select'),
    ghost = document.createElement('input'),
    remap = document.createElement('button')
bar.className = 'bar'
canvas.className = 'canvas'
send.textContent = '保存并发送位置'
cancel.textContent = '取消定位'
remap.textContent = '确认此重映射'
text.maxLength = 2048
text.placeholder = '批注（本地保留）'
ghost.type = 'checkbox'
ghost.checked = true
const label = document.createElement('label')
label.append(ghost, document.createTextNode('基线幽灵层'))
bar.append(status, parts, label, prompt, text, send, remap, cancel)
root.append(bar, canvas)
let stage: Stage,
    nonce = '',
    generation = 0,
    reportId = '',
    snapshotId = '',
    candidate: unknown,
    requestId: string | undefined,
    clicked: unknown,
    display: EvidenceDisplay | undefined
let retainedMarkers:Array<{position:number[];status?:string}>=[],retainedLines:Array<{a:number[];b:number[]}>=[]
function markers(){const c=candidate as {position?:number[]}|undefined;stage?.setEvidenceMarkers([...(c?.position?[{position:c.position,status:'candidate'}]:[]),...retainedMarkers].slice(0,200),retainedLines)}
let chunks: Uint8Array[] = [],
    total = 0,
    header: { bytes: number; hash: string; count: number } | undefined
const options: ViewOptions = { environment: Environment.None, buildPlateOrigin: 'lower-left' as ViewOptions['buildPlateOrigin'], renderMode: RenderMode.Solid, camera: CameraMode.Perspective, modelColor: null, shadows: false, fogDensity: 0 },
    settings: ViewOptionsContext = {
        options,
        get: (k) => options[k],
        is: (k, v) => options[k] === v,
        set: (k, v) => {
            options[k] = v
        },
    }
function interaction() {
    send.disabled = !requestId || !clicked
    remap.hidden = !requestId || !candidate
    cancel.hidden = !requestId
    text.hidden = !requestId
    send.hidden = !requestId || !!candidate
}
async function init(forceWebGL = false) {
    stage = new Stage(canvas, readPreviewTheme(getComputedStyle(document.body)), { forceWebGL })
    stage.setErrorCallback((m) => {
        status.textContent = m
        post({ type: 'viewError', nonce, generation, message: m })
    })
    try {
        await stage.ready
    } catch (e) {
        stage.dispose()
        canvas.replaceChildren()
        if (!forceWebGL) return init(true)
        throw e
    }
    stage.applySettings(settings)
    stage.addSceneObject('ambient-light', 'evidence-ambient')
    stage.addSceneObject('directional-light', 'evidence-light')
    stage.setEvidencePicking((hit) => {
        if (!requestId) return
        clicked = hit
        status.textContent = '已选取表面；确认后保存并发送'
        interaction()
    })
}
const ready = init()
new ResizeObserver(() => stage?.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas)
function envelope(type: string) {
    return { type, nonce, generation, reportId, snapshotId, requestId }
}
send.onclick = () => {
    if (requestId && clicked) {
        post({ ...envelope('submitPoint'), pick: clicked, text: text.value })
        send.disabled = true
    }
}
remap.onclick = () => {
    if (requestId && candidate) {
        post({ ...envelope('confirmRemap'), text: text.value })
        remap.disabled = true
    }
}
cancel.onclick = () => post(envelope('cancelPointing'))
ghost.onchange = () => stage?.setEvidenceVisible('baseline', undefined, ghost.checked)
parts.onchange = () => {
    for (const id of new Set(display?.parts.map((p) => p.partId) ?? [])) stage.setEvidenceVisible('target', id, parts.value === '*' || parts.value === (id ?? '@document'))
}
window.addEventListener('message', async (event: MessageEvent) => {
    const m = event.data
    if (!m || typeof m !== 'object') return
    try {
        if (m.type === 'beginEvidence') {
            if (!Number.isInteger(m.bytes) || m.bytes < 0 || m.bytes > 128 * 1048576 || !Number.isInteger(m.count) || m.count > 64) throw new Error('Evidence payload exceeds budget')
            nonce = m.nonce
            generation = m.generation
            reportId = m.reportId
            snapshotId = m.snapshotId
            chunks = []
            total = 0
            header = { bytes: m.bytes, hash: m.hash, count: m.count }
            status.textContent = '正在载入冻结验证证据'
            post(envelope('nextChunk'))
            return
        }
        if (m.nonce !== nonce || m.generation !== generation) return
        if (m.type === 'evidenceChunk') {
            if (!header || m.index !== chunks.length || typeof m.data !== 'string' || m.data.length > 6 * 1048576) throw new Error('Unexpected evidence chunk')
            const raw = atob(m.data),
                bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
            total += bytes.length
            if (total > header.bytes) throw new Error('Evidence length mismatch')
            chunks.push(bytes)
            if (chunks.length < header.count) {
                post(envelope('nextChunk'))
                return
            }
            if (total !== header.bytes) throw new Error('Evidence length mismatch')
            const all = new Uint8Array(total)
            let at = 0
            for (const b of chunks) {
                all.set(b, at)
                at += b.length
            }
            chunks = []
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', all)))
                .map((v) => v.toString(16).padStart(2, '0'))
                .join('')
            if (hash !== header.hash) throw new Error('Evidence hash mismatch')
            display = decodeDisplay(all)
            await ready
            await stage.loadModelData({ format: ModelFormat.Evidence, evidence: display, base64Data: null, isLoading: false, loadingMessage: '', export: () => {}, sendToSlicer: () => {} })
            stage.initializeView(false)
            parts.replaceChildren()
            const allOption = document.createElement('option')
            allOption.value = '*'
            allOption.textContent = '全部目标零件'
            parts.append(allOption)
            for (const id of new Set(display.parts.filter((p) => p.role === 'target').map((p) => p.partId))) {
                const option = document.createElement('option')
                option.value = id ?? '@document'
                option.textContent = id ?? '整个模型（无稳定零件）'
                parts.append(option)
            }
            status.textContent = '冻结证据；不表示模型已通过验证'
            post(envelope('evidenceReady'))
            return
        }
        if (m.type === 'viewState') {
            status.textContent = `${m.current?'当前冻结快照':'STALE：历史冻结证据'} · ${m.frame??'source'} · 显示误差 ≤ ${m.maxCoordinateError??0} ${m.units??'modelUnits'} · 蓝色基线／橙色变化零件；仅摘要比较`
            retainedMarkers=m.markers??[];retainedLines=m.lines??[];markers()
            return
        }
        if (m.type === 'pointing') {
            requestId = m.requestId
            candidate = m.candidate
            markers()
            clicked = undefined
            text.value = ''
            prompt.textContent = m.prompt
            remap.disabled = false
            interaction()
            return
        }
        if (m.type === 'pointingEnded') {
            requestId = undefined
            candidate = undefined
            markers()
            clicked = undefined
            prompt.textContent = m.message ?? ''
            interaction()
            return
        }
        if (m.type === 'viewError') status.textContent = m.message
    } catch (e) {
        status.textContent = String(e)
        post({ ...envelope('viewError'), message: String(e) })
    }
})
window.addEventListener('pagehide', () => stage?.dispose())
interaction()
post({ type: 'ready' })
