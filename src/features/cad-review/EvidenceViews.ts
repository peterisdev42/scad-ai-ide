import * as vscode from 'vscode'
import { randomUUID, createHash } from 'node:crypto'
import { decodeDisplay, type EvidenceDisplay } from '../../core/review/display'
import { reviewLimits, type Anchor, type FeedbackRecord, type SubjectInput,type DerivedReport } from '../../core/review/types'
import { reviewWorker } from '../../platform/review/ReviewWorker'
import type { ReviewWorkspaceService, ReviewViewAdapter, PointingInteraction } from './ReviewWorkspaceService'
import type { EvidenceHandle } from './EvidenceRepository'
import type { pickSurface, PickRequest } from '../../core/review/geometry'
interface View {
    reviewId?:string
    derived?:DerivedReport
    panel: vscode.WebviewPanel
    target: EvidenceHandle
    baseline?: EvidenceHandle
    inputs: SubjectInput[]
    nonce: string
    generation: number
    display: EvidenceDisplay
    bytes: Uint8Array
    sent: number
    ready: boolean
    pending?: { id: string; input: PointingInteraction; resolve: (f: FeedbackRecord) => void; reject: (e: Error) => void }
    subscriptions: vscode.Disposable[]
    disposed: boolean
}
export class EvidenceViews implements ReviewViewAdapter {
    private views = new Set<View>()
    private opening=0
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly review: ReviewWorkspaceService,
    ) {}
    async open(id: string, baselineId?: string) {
        await this.openView(id, baselineId)
    }
    private async openView(id: string, baselineId?: string,signal?:AbortSignal): Promise<View> {
        const reviewId=this.review.has(id)?id:undefined,derived=reviewId?this.review.get(reviewId):undefined
        if (derived) {
            if (derived.kind === 'comparison') {
                id = derived.targetReportId
                baselineId = derived.baselineReportId
            } else id = derived.sourceReportId
        }
        const old = [...this.views].find((v) => !v.disposed && v.target.report.reportId === id && v.baseline?.report.reportId === baselineId&&v.reviewId===reviewId)
        if (old) {
            old.panel.reveal()
            return old
        }
        if (this.views.size+this.opening >= reviewLimits.views) throw new Error('VIEW_LIMIT_REACHED: close another evidence view first.')
        this.opening++
        let target:EvidenceHandle|undefined,baseline:EvidenceHandle|undefined
        try {
            target=await this.review.evidence.resolve(id);baseline=baselineId?await this.review.evidence.resolve(baselineId):undefined
            const inputs = await this.review.evidence.inputs(target,derived?.kind==='print-assessment'&&derived.partId?[derived.partId]:undefined)
            if(derived?.kind==='print-assessment')for(const input of inputs){input.worldMatrix=undefined;input.transform=derived.profile.buildPose}
            if (!inputs.length) throw new Error('GEOMETRY_EVIDENCE_UNAVAILABLE: this report has no decodable frozen mesh.')
            const active = signal?AbortSignal.any([signal,AbortSignal.timeout(reviewLimits.totalMs)]):AbortSignal.timeout(reviewLimits.totalMs),
                render = (await this.review.cad.geometry!.runGeometry((s) => reviewWorker({ operation: 'view', subjects: inputs, role: 'target' }, s), active)) as { display: Uint8Array },
                decoded = decodeDisplay(render.display)
            if(derived?.kind==='comparison')for(const part of decoded.parts)part.changed=derived.rows.some(r=>r.partId===part.partId&&['added','changed'].includes(r.status))
            if (baseline) {
                const baselineInputs = await this.review.evidence.inputs(baseline)
                const other = (await this.review.cad.geometry!.runGeometry((s) => reviewWorker({ operation: 'view', subjects: baselineInputs, role: 'baseline', origin: decoded.origin }, s), active)) as { display: Uint8Array }
                const before=decodeDisplay(other.display);decoded.maxCoordinateError=Math.max(decoded.maxCoordinateError,before.maxCoordinateError);decoded.parts.push(...before.parts)
            }
            const bytes = encodePacket(decoded)
            if (bytes.length > reviewLimits.viewBytes) throw new Error('VIEW_BUDGET_EXCEEDED')
            const panel = vscode.window.createWebviewPanel('scad-cad-evidence', `CAD Evidence · ${target.report.snapshot.id.slice(0, 8)}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] })
            const view: View = { reviewId,derived,panel, target, baseline, inputs, nonce: randomUUID(), generation: 1, display: decoded, bytes, sent: 0, ready: false, subscriptions: [], disposed: false }
            this.views.add(view)
            view.subscriptions.push(
                panel.webview.onDidReceiveMessage(
                    (m) =>
                        void this.message(view, m).catch((e) => {
                            void panel.webview.postMessage({ type: 'viewError', nonce: view.nonce, generation: view.generation, message: String(e) })
                            if (view.pending) this.fail(view, e instanceof Error ? e : new Error(String(e)))
                        }),
                ),
                panel.onDidDispose(() => this.close(view)),
                this.review.onDidChange(() => void this.state(view).catch(() => {})),
            )
            panel.webview.html = this.html(panel.webview)
            return view
        } catch (e) {
            target?.release()
            baseline?.release()
            throw e
        }finally{this.opening--}
    }
    private html(webview: vscode.Webview) {
        const nonce = randomUUID(),
            script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'review-view.js'))
        return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; connect-src ${webview.cspSource} data: blob:; worker-src blob:;"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}#root{height:100vh;display:flex;flex-direction:column}.bar{padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--vscode-panel-border)}.bar p{width:100%;margin:0}.canvas{position:relative;flex:1;min-height:100px}button,select,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:4px}textarea{width:30em;height:3em}button{cursor:pointer}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}</style></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`
    }
    private async message(v: View, m: unknown) {
        if (v.disposed || !m || typeof m !== 'object') return
        const data = m as Record<string, unknown>
        if (data.type === 'ready') {
            v.sent = 0
            v.ready = false
            await v.panel.webview.postMessage({ type: 'beginEvidence', nonce: v.nonce, generation: v.generation, reportId: v.target.report.reportId, snapshotId: v.target.report.snapshot.id, bytes: v.bytes.length, count: Math.ceil(v.bytes.length / reviewLimits.chunkBytes), hash: createHash('sha256').update(v.bytes).digest('hex') })
            return
        }
        if (data.nonce !== v.nonce || data.generation !== v.generation || data.reportId !== v.target.report.reportId || data.snapshotId !== v.target.report.snapshot.id) return
        if (data.type === 'nextChunk') {
            const index = v.sent++,
                at = index * reviewLimits.chunkBytes
            if (at >= v.bytes.length) return
            await v.panel.webview.postMessage({ type: 'evidenceChunk', nonce: v.nonce, generation: v.generation, index, data: Buffer.from(v.bytes.subarray(at, at + reviewLimits.chunkBytes)).toString('base64') })
            return
        }
        if (data.type === 'evidenceReady') {
            v.ready = true
            await this.state(v)
            this.sendRequest(v)
            return
        }
        if (data.type === 'viewError') {
            this.fail(v, new Error('EVIDENCE_VIEW_UNAVAILABLE: ' + String(data.message).slice(0, 2048)))
            return
        }
        const pending = v.pending
        if (!pending || data.requestId !== pending.id || !v.ready) return
        if (data.type === 'cancelPointing') {
            this.fail(v, new DOMException('User cancelled pointing', 'AbortError'))
            return
        }
        if (data.type !== 'submitPoint' && data.type !== 'confirmRemap') return
        if (!(await v.target.current())) {
            this.fail(v, new Error('STALE_SNAPSHOT: inputs changed before submission.'))
            return
        }
        const text = typeof data.text === 'string' ? data.text : ''
        if (Buffer.byteLength(text) > reviewLimits.textBytes) throw new Error('Feedback text exceeds 2 KiB.')
        let anchor: Anchor
        if (data.type === 'confirmRemap') {
            const c = pending.input.candidate
            if (!c) throw new Error('REMAP_NOT_AVAILABLE')
            const source = v.target.report.schemaVersion === 3 ? v.target.report.snapshot.sources.find((s) => s.partId === c.partId) : undefined
            if (!source) throw new Error('REMAP_NOT_AVAILABLE')
            anchor = { reportId: v.target.report.reportId, snapshotId: v.target.report.snapshot.id, revision: v.target.report.snapshot.id, partId: c.partId, objectId: c.partId, anchorHash: c.anchorHash, triangle: 0, mesh: 0, position: c.position, localPosition: [0, 0, 0], normal: c.normal, localNormal: [0, 0, 1], matrix: c.matrix, units: v.target.report.units, camera: null, source: { uri: source.uri, selector: source.selector, instanceId: 'same-local-mesh', sourceTriangle: 0, confidence: 'mesh-only' } }
        } else {
            const pick = data.pick as { key?: string; triangle?: number; ray?: PickRequest['ray']; camera?: unknown } | undefined
            if (!pick || typeof pick.key !== 'string' || !Number.isInteger(pick.triangle) || !pick.ray) throw new Error('PICK_UNRESOLVED')
            const part = v.display.parts.find((p) => p.key === pick.key && p.role === 'target')
            if (!part) throw new Error('PICK_UNRESOLVED')
            const input = v.inputs.find((p) => p.id === part.partId)
            if (!input) throw new Error('PICK_UNRESOLVED')
            const result = (await this.review.cad.geometry!.runGeometry((s) => reviewWorker({ operation: 'pick', subjects: [input], pick: { mesh: part.mesh, triangle: pick.triangle!, ray: pick.ray!, camera: pick.camera } }, s, 5000), AbortSignal.timeout(6000))) as ReturnType<typeof pickSurface>
            const source = v.target.report.schemaVersion === 3 ? v.target.report.snapshot.sources.find((s) => s.partId === part.partId) : undefined
            const camera = JSON.stringify(pick.camera)
            if (camera && camera.length > 4096) throw new Error('PICK_CAMERA_BUDGET')
            anchor = { reportId: v.target.report.reportId, snapshotId: v.target.report.snapshot.id, revision: v.target.report.snapshot.id, partId: part.partId, objectId: part.key, anchorHash: result.anchorHash, triangle: pick.triangle!, mesh: part.mesh, position: result.position, localPosition: result.localPosition, normal: result.normal, localNormal: result.localNormal, matrix: result.matrix, units: v.target.report.units, camera: pick.camera ?? null, source: { uri: source?.uri ?? v.target.report.snapshot.document.uri, selector: source?.selector, instanceId: result.instanceId, sourceTriangle: pick.triangle!, confidence: 'mesh-only' } }
        }
        const record = await pending.input.submit(anchor, text)
        if (v.pending !== pending) return
        v.pending = undefined
        pending.resolve(record)
        await v.panel.webview.postMessage({ type: 'pointingEnded', nonce: v.nonce, generation: v.generation, message: '批注已保存' })
        await this.state(v)
    }
    private async state(v: View) {
        if (v.disposed || !v.ready) return
        const current = await v.target.current(),
            list = await v.target.store.list(),
            markers = list.feedback
                .filter((f) => v.derived?.kind!=='print-assessment'&&f.ownerUri === v.target.ownerUri && f.anchor.snapshotId === v.target.report.snapshot.id)
                .slice(0, 200)
                .map((f) => ({ position: f.anchor.position, status: f.status as string })),
            lines = v.target.report.schemaVersion === 3 ? (v.target.report.facts?.pairs.flatMap((p) => (p.closestPoints ? [{ a: p.closestPoints[0], b: p.closestPoints[1] }] : [])) ?? []) : []
        if(v.derived?.kind==='print-assessment')markers.push(...v.derived.result.overhang.samples.slice(0,200).map(s=>({position:s.point,status:'candidate'})))
        await v.panel.webview.postMessage({ type: 'viewState', nonce: v.nonce, generation: v.generation, current,markers:markers.slice(0,200),lines,frame:v.derived?.kind==='print-assessment'?'print pose':'assembly/source',maxCoordinateError:v.display.maxCoordinateError,units:v.target.report.units })
        if (!current && v.pending) this.fail(v, new Error('STALE_SNAPSHOT: requested input changed.'))
    }
    private sendRequest(v: View) {
        if (v.ready && v.pending) void v.panel.webview.postMessage({ type: 'pointing', nonce: v.nonce, generation: v.generation, requestId: v.pending.id, prompt: v.pending.input.prompt, candidate: v.pending.input.candidate })
    }
    async request(input: PointingInteraction, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const view = await this.openView(input.reportId,undefined,signal)
        signal?.throwIfAborted()
        if (view.pending) throw new Error('BUSY: another pointing request is active.')
        return new Promise<FeedbackRecord>((resolve, reject) => {
            const finish = (f?: FeedbackRecord, e?: Error) => {
                    signal?.removeEventListener('abort', abort)
                    if (e) reject(e)
                    else resolve(f!)
                },
                abort = () => this.fail(view, new DOMException('Pointing cancelled or timed out', 'AbortError'))
            view.pending = { id: randomUUID(), input, resolve: (f) => finish(f), reject: (e) => finish(undefined, e) }
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) abort()
            else this.sendRequest(view)
        })
    }
    private fail(v: View, error: Error) {
        const p = v.pending
        if (!p) return
        v.pending = undefined
        p.reject(error)
        void v.panel.webview.postMessage({ type: 'pointingEnded', nonce: v.nonce, generation: v.generation, message: error.message })
    }
    private close(v: View) {
        if (v.disposed) return
        v.disposed = true
        this.fail(v, new DOMException('Evidence view closed', 'AbortError'))
        v.target.release()
        v.baseline?.release()
        v.subscriptions.forEach((s) => s.dispose())
        this.views.delete(v)
    }
    dispose() {
        for (const v of [...this.views]) {
            this.close(v)
            v.panel.dispose()
        }
    }
}
function encodePacket(display: EvidenceDisplay) {
    const meta = Buffer.from(JSON.stringify({ ...display, parts: display.parts.map((p) => ({ ...p, positions: p.positions.length, indices: p.indices.length })) })),
        head = Buffer.alloc(8)
    head.write('EVW1')
    head.writeUInt32LE(meta.length, 4)
    const chunks = [head, meta]
    for (const p of display.parts) {
        const a = Buffer.alloc(p.positions.byteLength),
            b = Buffer.alloc(p.indices.byteLength)
        p.positions.forEach((v, i) => a.writeFloatLE(v, i * 4))
        p.indices.forEach((v, i) => b.writeUInt32LE(v, i * 4))
        chunks.push(a, b)
    }
    return Buffer.concat(chunks)
}
