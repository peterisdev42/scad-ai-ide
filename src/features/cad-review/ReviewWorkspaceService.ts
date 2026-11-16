import { readWorldArtifact } from '../../core/assembly/worldMesh'
import { displayMesh } from '../../core/mesh/displayMesh'
import { assertWorkspacePath } from '../../platform/WorkspacePaths'
import * as vscode from 'vscode'
import { randomUUID,createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { digest } from '../../core/cad/snapshot'
import { SharedTasks } from '../../core/cad/SharedTasks'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { compareReports } from '../../core/review/compare'
import { parsePrintProfile } from '../../core/review/profile'
import { acceptedRemap, remapCandidate } from '../../core/review/feedback'
import { reviewLimits, type VerificationEvidence, type SubjectDigest, type DerivedReport, type ComparisonReport, type PrintAssessment, type PrintResult, type ReviewIssue, type Anchor, type FeedbackRecord, type RemapCandidate } from '../../core/review/types'
import { configureReviewWorker, reviewWorker } from '../../platform/review/ReviewWorker'
import { EvidenceRepository, type EvidenceHandle } from './EvidenceRepository'
import type { CadWorkspaceService } from '../cad-verification/CadWorkspaceService'
export interface PointingInteraction {
    reportId: string
    prompt: string
    ttlMs: number
    candidate?: RemapCandidate
    submit(anchor: Anchor, text: string): Promise<FeedbackRecord>
}
export interface ReviewViewAdapter {
    open(reportId: string, baselineReportId?: string): Promise<void>
    request(input: PointingInteraction, signal?: AbortSignal): Promise<FeedbackRecord>
    dispose(): void
}
export class ReviewWorkspaceService implements vscode.Disposable {
    readonly evidence: EvidenceRepository
    views?: ReviewViewAdapter
    private reports = new Map<string, DerivedReport>()
    private tasks = new SharedTasks<DerivedReport>()
    private compareCache = new Map<string, string>()
    private subscriptions: vscode.Disposable[] = []
    private generation = 0
    private timer?: ReturnType<typeof setTimeout>
    private pendingPointing = false
    private staleRequests = new Set<string>()
    private changed = new vscode.EventEmitter<void>()
    readonly onDidChange = this.changed.event
    constructor(
        context: vscode.ExtensionContext,
        readonly cad: CadWorkspaceService,
    ) {
        this.evidence = new EvidenceRepository(context, cad)
        configureReviewWorker(vscode.Uri.joinPath(context.extensionUri, 'dist', 'review-geometry-worker.mjs').fsPath)
        const watcher = vscode.workspace.createFileSystemWatcher('**/*'),
            refresh = (uri?: vscode.Uri) => {
                this.generation++
                if (uri) this.staleRequests.add(uri.toString())
                this.scheduleRefresh()
            }
        this.subscriptions.push(
            watcher,
            watcher.onDidChange(refresh),
            watcher.onDidCreate(refresh),
            watcher.onDidDelete(refresh),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.contentChanges.length) {
                    this.generation++
                    this.staleRequests.add(e.document.uri.toString())
                    this.scheduleRefresh()
                }
            }),
            vscode.workspace.onDidChangeConfiguration(() => refresh()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
        )
    }
    private scheduleRefresh() {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.refresh().catch(() => {}), 100)
        this.timer.unref()
    }
    async refresh() {
        if (!vscode.workspace.isTrusted) return
        const changes=new Set(this.staleRequests);this.staleRequests.clear();for(const raw of [...changes]){try{const uri=vscode.Uri.parse(raw,true);if(uri.scheme==='file')changes.add(vscode.Uri.file(await realpath(uri.fsPath)).toString())}catch{/* Deleted inputs are caught by the current check. */}}
        for (const store of await this.evidence.activeStores()) {
            const list = await store.list(),
                stale = new Set<string>()
            for (const f of list.feedback) {
                if (f.status === 'stale') continue
                const bundle = await store.get(f.anchor.reportId)
                if (!bundle || !(await this.evidence.current(bundle.report)) || changes.has(f.ownerUri) || changes.has(f.anchor.source.uri) || bundle.report.snapshot.dependencies.some((d) => changes.has(d.uri)) || (bundle.report.schemaVersion === 3 && bundle.report.snapshot.sources.some((s) => changes.has(s.uri) || s.sourceReport.snapshot.dependencies.some((d) => changes.has(d.uri))))) {
                    stale.add(f.anchor.reportId)
                }
            }
            if (stale.size) await store.markStale(stale)
        }
        this.changed.fire()
        this.cad.notifyGeometryReports()
        void this.cad.problems.revalidate()
    }
    private store(report: DerivedReport) {
        const bytes = Buffer.byteLength(JSON.stringify(report))
        if (bytes > 16 * 1048576) throw new CapabilityError('REVIEW_REPORT_BUDGET', 'Review report exceeds evidence budget.')
        const frozen = structuredClone(report),
            freeze = (v: unknown) => {
                if (v && typeof v === 'object' && !Object.isFrozen(v)) {
                    Object.freeze(v)
                    Object.values(v).forEach(freeze)
                }
            }
        freeze(frozen)
        this.reports.set(report.reportId, frozen)
        this.prune()
        return frozen
    }
    private prune() {
        let bytes = 0
        for (const [id, r] of this.reports) {
            if (Date.now() - r.createdAt >= 1800000) this.reports.delete(id)
            else bytes += Buffer.byteLength(JSON.stringify(r))
        }
        while (this.reports.size > 128 || bytes > 16 * 1048576) {
            const id = this.reports.keys().next().value!
            bytes -= Buffer.byteLength(JSON.stringify(this.reports.get(id)))
            this.reports.delete(id)
        }
        for (const [key, id] of this.compareCache) if (!this.reports.has(id)) this.compareCache.delete(key)
    }
    has(id: string) {
        this.prune()
        return this.reports.has(id)
    }
    get(id: string) {
        this.evidence.trust()
        this.prune()
        const r = this.reports.get(id)
        if (!r) throw new CapabilityError('REPORT_NOT_FOUND', 'Review report expired; no geometry was recomputed.')
        return r
    }
    private signal(caller?: AbortSignal) {
        const deadline = AbortSignal.timeout(reviewLimits.totalMs)
        return caller ? AbortSignal.any([caller, deadline]) : deadline
    }
    async geometryDigest(handle: EvidenceHandle, signal?: AbortSignal) {
        const inputs = await this.evidence.inputs(handle)
        signal?.throwIfAborted()
        return (await this.cad.geometry!.runGeometry((active) => reviewWorker({ operation: 'digest', subjects: inputs }, active), signal ?? AbortSignal.timeout(reviewLimits.totalMs))) as SubjectDigest[]
    }
    async compare(input: { reportId?: string; baselineReportId?: string; targetReportId?: string; expectUnchangedPartIds?: string[]; offset?: number; limit?: number; section?: 'parts' | 'checks' | 'issues' }, signal?: AbortSignal) {
        this.evidence.trust()
        const active = this.signal(signal)
        if (input.reportId) {
            if(!this.has(input.reportId)&&(this.cad.geometry?.core.has(input.reportId)||this.cad.assembly?.core.has(input.reportId)))throw new CapabilityError('INVALID_INPUT','reportId reads a comparison result returned by model_compare. To compare frozen model reports, provide baselineReportId and targetReportId instead.')
            const r = this.get(input.reportId)
            if (r.kind !== 'comparison') throw new CapabilityError('INVALID_INPUT', 'Expected a comparison report.')
            return this.comparisonSummary(r, input)
        }
        if (!input.baselineReportId || !input.targetReportId) throw new CapabilityError('INVALID_INPUT', 'Provide both frozen report identities.')
        const a = await this.evidence.resolve(input.baselineReportId)
        let b:EvidenceHandle;try{b=await this.evidence.resolve(input.targetReportId)}catch(e){a.release();throw e}
        try {
            const key = digest([a.report.reportId,b.report.reportId,a.report.snapshot.id, b.report.snapshot.id, input.expectUnchangedPartIds?.slice().sort() ?? [], 'summary-diff-v1']),
                cached = this.compareCache.get(key)
            if (cached && this.has(cached)) return this.comparisonSummary(this.get(cached) as ComparisonReport, input)
            const result = (await this.tasks.run(
                key,
                async (shared) => {
                    const taskA = await this.evidence.resolve(a.report.reportId)
                    let taskB:EvidenceHandle;try{taskB=await this.evidence.resolve(b.report.reportId)}catch(e){taskA.release();throw e}
                    try {
                        const ad = await this.geometryDigest(taskA, shared),
                            bd = await this.geometryDigest(taskB, shared)
                        shared.throwIfAborted()
                        const report = compareReports(a.report, b.report, ad, bd, input.expectUnchangedPartIds, { baseline: a.ownerUri, target: b.ownerUri })
                        shared.throwIfAborted()
                        const r = this.store(report)
                        this.compareCache.set(key, r.reportId)
                        return r
                    } finally {
                        taskA.release()
                        taskB.release()
                    }
                },
                active,
            )) as ComparisonReport
            active.throwIfAborted()
            if ((await b.current()) && vscode.workspace.getConfiguration('scad-ai-ide.verification').get<boolean>('publishProblems', true)) await this.cad.problems.reportVerification({ reportId: result.reportId, snapshot: { id: b.report.snapshot.id, document: b.report.snapshot.document, dependencies: b.report.snapshot.dependencies }, issues: result.issues }, () => this.evidence.current(b.report), 'review-comparison')
            this.cad.notifyGeometryReports()
            return this.comparisonSummary(result, input)
        } finally {
            a.release()
            b.release()
        }
    }
    private page<T>(values: T[], offset = 0, limit = 20) {
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new CapabilityError('INVALID_INPUT', 'Invalid review pagination.')
        const items = values.slice(offset, offset + limit)
        while (Buffer.byteLength(JSON.stringify(items)) > 24000 && items.length > 1) items.pop()
        return { items, total: values.length, offset, nextOffset: offset + items.length < values.length ? offset + items.length : null }
    }
    async current(id: string) {
        try {
            const h = await this.evidence.resolve(id)
            try {
                return await h.current()
            } finally {
                h.release()
            }
        } catch {
            return false
        }
    }
    async comparisonSummary(r: ComparisonReport, input: { section?: 'parts' | 'checks' | 'issues'; offset?: number; limit?: number } = {}) {
        const section = input.section ?? 'parts'
        return { kind: r.kind, schemaVersion: 1, reportId: r.reportId, reportUri: `scad-cad-report:/${r.reportId}`, baselineReportId: r.baselineReportId, targetReportId: r.targetReportId, baselineModelStatus:r.baselineModelStatus,targetModelStatus:r.targetModelStatus,baselineSnapshotId: r.baselineSnapshotId, targetSnapshotId: r.targetSnapshotId, current: { baseline: await this.current(r.baselineReportId), target: await this.current(r.targetReportId) }, units: r.units, comparisonStatus: r.comparisonStatus, regressionStatus: r.regressionStatus, scope: 'frozen-exported-mesh-summary; no analytic or within-part region guarantee', incomplete: r.incomplete, section, ...this.page<unknown>(section === 'parts' ? r.rows : section === 'checks' ? r.checks : r.issues, input.offset, input.limit), issueIds: r.issues.map((i) => i.id).slice(0, 32), notChecked: ['surface-distance-heatmap', 'boolean-difference', 'within-part-preservation'] }
    }
    async print(input: { reportId: string; profileUri?: string; expectedProfileDigest?: string; partId?: string }, signal?: AbortSignal) {
        this.evidence.trust()
        const existing = this.reports.get(input.reportId)
        if (existing) {
            if (existing.kind !== 'print-assessment' || input.profileUri || input.partId) throw new CapabilityError('INVALID_INPUT', 'Cannot override a frozen print assessment.')
            return this.printSummary(existing)
        }
        if (!input.profileUri) throw new CapabilityError('PRINT_PROFILE_REQUIRED', 'Select an explicit local printing profile. No profile was created.')
        const h = await this.evidence.resolve(input.reportId),
            active = this.signal(signal)
        try {
            if (h.report.units !== 'mm') throw new CapabilityError('UNIT_DECLARATION_REQUIRED', 'Verify with explicit millimeter units before checking a millimeter profile.')
            if (h.report.schemaVersion === 3 && !input.partId) throw new CapabilityError('PART_ID_REQUIRED', 'Choose one declared part; assembly placement is not a print layout.')
            const profile = await this.profile(input.profileUri)
            if (input.expectedProfileDigest && profile.digest !== input.expectedProfileDigest) throw new CapabilityError('PRINT_PROFILE_BASELINE_CHANGED', 'Profile changed; read the new print setup explicitly.')
            const subjects = await this.evidence.inputs(h, h.report.schemaVersion === 3 ? [input.partId!] : undefined)
            if (subjects.length !== 1) throw new CapabilityError('GEOMETRY_EVIDENCE_UNAVAILABLE', 'A single frozen subject is required.')
            const source = h.report.schemaVersion === 3 ? h.report.snapshot.sources.find((s) => s.partId === input.partId)!.sourceReport : h.report
            const result = (await this.cad.geometry!.runGeometry((s) => reviewWorker({ operation: 'print', subjects, profile: profile.profile, trusted: source.overallStatus === 'PASS' }, s), active)) as PrintResult
            const after = await this.profile(input.profileUri)
            active.throwIfAborted()
            if (after.contentHash !== profile.contentHash) throw new CapabilityError('PRINT_PROFILE_BASELINE_CHANGED', 'Profile changed during screening.')
            const id = `cad-${randomUUID()}`,
                issues: ReviewIssue[] = []
            const add = (code: string, title: string, spatial?: unknown) => issues.push({ id: digest([id, code]), code, title, source: 'print', severity: 'warning', status: code === 'PRINT_ENVELOPE_VIOLATION' ? 'FAIL' : 'UNRESOLVED', location: { uri: h.ownerUri, line: 0, character: 0, confidence: 'fallback' }, relatedTrace: [], evidenceIds: [], partIds: input.partId ? [input.partId] : undefined, spatial })
            if (result.envelope.status === 'FAIL') add('PRINT_ENVELOPE_VIOLATION', 'Mesh exceeds the selected build envelope.', result.envelope)
            if (result.overhang.candidateCount) add('PRINT_OVERHANG_CANDIDATES', `${result.overhang.candidateCount} triangle overhang candidates; support requirements were not verified.`, result.overhang.samples)
            if (result.incomplete.length || result.envelope.status === 'UNRESOLVED') add('PRINT_SCREENING_UNRESOLVED', result.incomplete.join(', ') || 'Build envelope boundary is unresolved.')
            const report: PrintAssessment = { kind: 'print-assessment', schemaVersion: 1, reportId: id, sourceReportId: h.report.reportId, snapshotId: h.report.snapshot.id, ownerUri: h.ownerUri, profileUri: profile.uri, profileDigest: profile.digest, profileContentHash: profile.contentHash, profile: profile.profile, partId: input.partId ?? null, units: 'mm', assessmentStatus: result.incomplete.length || result.envelope.status === 'UNRESOLVED' ? 'PARTIAL' : 'COMPLETE', printability: 'NOT_CHECKED', result, issues, notChecked: ['wall-thickness', 'bridging', 'supports', 'bed-adhesion', 'slicer', 'material', 'manufacturing-success'], createdAt: Date.now() }
            this.store(report)
            if (await h.current()) await this.cad.problems.reportVerification({ reportId: id, snapshot: { id: h.report.snapshot.id, document: h.report.snapshot.document, dependencies: h.report.snapshot.dependencies }, issues }, async () => (await this.evidence.current(h.report)) && (await this.profile(profile.uri)).contentHash === profile.contentHash, 'review-print')
            return this.printSummary(report)
        } finally {
            h.release()
        }
    }
    private async profile(raw: string) {
        const uri = vscode.Uri.parse(raw, true)
        await assertWorkspacePath(uri)
        if (!/\.json$/i.test(uri.path) || (await stat(uri.fsPath)).size > 65536) throw new CapabilityError('PRINT_PROFILE_INVALID', 'Select a JSON profile up to 64 KiB.')
        const path = await realpath(uri.fsPath),
            open = await Promise.all(vscode.workspace.textDocuments.filter((d) => !d.isClosed && d.isDirty && d.uri.scheme === 'file').map(async (d) => ({ d, path: await realpath(d.uri.fsPath).catch(() => undefined) }))),
            doc = open.find((d) => d.path === path)?.d,
            text = doc?.getText() ?? new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path)))
        try {
            return { ...parsePrintProfile(text), uri: vscode.Uri.file(path).toString() }
        } catch (e) {
            throw new CapabilityError('PRINT_PROFILE_INVALID', e instanceof Error ? e.message : 'Invalid profile')
        }
    }
    async printSummary(r: PrintAssessment) {
        let profileCurrent = false
        try {
            profileCurrent = (await this.profile(r.profileUri)).contentHash === r.profileContentHash
        } catch {
            /* Historical assessment remains readable. */
        }
        return { ...r, result: { ...r.result, overhang: { ...r.result.overhang, samples: r.result.overhang.samples.slice(0, 10) } }, issues: r.issues.map(({ spatial: _s, ...i }) => i), current: (await this.current(r.sourceReportId)) && profileCurrent, reportUri: `scad-cad-report:/${r.reportId}`, precision: 'frozen-Float64-envelope; numerical-triangle-angle-candidates' }
    }
    async issueDetails(reportId: string, issueId: string, includeEvidence: boolean, cursor = 0, limit = 100) {
        const r = this.get(reportId),
            issue = r.issues.find((i) => i.id === issueId)
        if (!issue) throw new CapabilityError('ISSUE_NOT_FOUND', 'Issue does not belong to this review report.')
        const items = r.kind === 'comparison' ? issue.partIds?r.rows.filter(row=>row.partId!==null&&issue.partIds!.includes(row.partId)):r.checks.filter((c) => issue.checkId?c.id===issue.checkId:c.transition === 'regression' || c.definitionChanged) : r.result.overhang.samples
        return { reportId, issue: { ...issue, spatial: includeEvidence ? issue.spatial : undefined }, current: await this.current(r.kind === 'comparison' ? r.targetReportId : r.sourceReportId), ...(includeEvidence ? { evidence: { text: JSON.stringify(issue.spatial ?? items).slice(0, 8192), truncated: JSON.stringify(issue.spatial ?? items).length > 8192 }, geometryEvidence: this.page<unknown>(items, cursor, limit) } : {}) }
    }
    async reportText(id: string) {
        const r = this.get(id)
        return JSON.stringify({ current: await this.current(r.kind === 'comparison' ? r.targetReportId : r.sourceReportId), ...r }, null, 2)
    }
    async getFeedback(input: { uri?: string; reportId?: string; snapshotId?: string; status?: string; targetReportId?: string; offset?: number; limit?: number }) {
        this.evidence.trust()
        if (!!input.uri === !!input.reportId) throw new CapabilityError('INVALID_INPUT', 'Provide exactly one owner URI or reportId.')
        const handle = input.reportId ? await this.evidence.resolve(input.reportId) : undefined
        try {
            const ownerUri = handle?.ownerUri ?? (await this.evidence.canonical(input.uri!)),
                store = handle?.store ?? (await this.evidence.storeForOwner(ownerUri))
            await this.refresh()
            const data = await store.list(),
                target = input.targetReportId ? await this.evidence.resolve(input.targetReportId) : undefined
            try {
                const targetCurrent = target ? await target.current() : false,
                    records = data.feedback.filter((f) => f.ownerUri === ownerUri && (!input.snapshotId || f.anchor.snapshotId === input.snapshotId) && (!input.status || f.status === input.status)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
                return {
                    ownerUri,
                    revision: data.revision,
                    ...this.page(
                        records.map((f) => ({ ...f, history:f.history.slice(-16),historyCount:f.history.length,historyTruncated:f.history.length>16,remapCandidate: target && targetCurrent ? remapCandidate(f, target.report) : null })),
                        input.offset,
                        input.limit,
                    ),
                    baselineItems: data.baselines.filter((b) => b.ownerUri === ownerUri).map(({ownerUri:_owner,...b})=>b),
                }
            } finally {
                target?.release()
            }
        } finally {
            handle?.release()
        }
    }
    async manage(input: { action: string; reportId?: string; uri?: string; feedbackId?: string; expectedRevision?: number; label?: string }) {
        this.evidence.trust()
        if (input.action === 'retainBaseline') {
            if (!input.reportId) throw new CapabilityError('INVALID_INPUT', 'Choose a report.')
            const h = await this.evidence.resolve(input.reportId)
            try {
                return await this.evidence.retain(h, true, input.label?.slice(0, 128))
            } finally {
                h.release()
            }
        }
        if (input.action === 'releaseBaseline') {
            if (!input.reportId) throw new CapabilityError('INVALID_INPUT', 'Choose a baseline.')
            for (const store of await this.evidence.activeStores()) if (await store.get(input.reportId)) return store.releaseBaseline(input.reportId)
            throw new CapabilityError('REPORT_NOT_FOUND', 'Unknown retained baseline.')
        }
        for (const store of await this.evidence.activeStores()) {
            const f = (await store.list()).feedback.find((f) => f.id === input.feedbackId)
            if (!f) continue
            if (input.expectedRevision !== f.recordRevision) throw new CapabilityError('STALE_REVIEW_REVISION', 'Read the feedback revision first.')
            if (input.action === 'deleteFeedback') return store.deleteFeedback(f.id, f.recordRevision)
            if (!['resolveFeedback', 'reopenFeedback'].includes(input.action)) throw new CapabilityError('INVALID_INPUT', 'Unknown review action.')
            if (input.action === 'reopenFeedback' && (!(await this.current(f.anchor.reportId)) || f.status === 'stale')) throw new CapabilityError('STALE_SNAPSHOT', 'Reconfirm or point again instead of reviving stale feedback.')
            const result = await store.putFeedback({ ...f, status: f.status === 'stale' ? 'stale' : input.action === 'resolveFeedback' ? 'resolved' : 'open', history: [...f.history, { at: Date.now(), action: input.action }] }, f.recordRevision)
            this.changed.fire()
            return result
        }
        throw new CapabilityError('FEEDBACK_NOT_FOUND', 'Unknown feedback.')
    }
    async requestPointing(input: { reportId: string; prompt: string; ttl?: number; remapCandidateId?: string; feedbackId?: string }, signal?: AbortSignal) {
        this.evidence.trust()
        if (this.pendingPointing) throw new CapabilityError('BUSY', 'Another pointing request is active.')
        if (!this.views) throw new CapabilityError('INTERACTION_UNAVAILABLE', 'A graphical evidence view is required; read-only tools remain available.')
        const ttl = (input.ttl ?? 120) * 1000
        if (!Number.isFinite(ttl) || ttl < 1000 || ttl > reviewLimits.maxPointingMs || Buffer.byteLength(input.prompt) > 1024) throw new CapabilityError('INVALID_INPUT', 'Invalid pointing prompt or TTL.')
        this.pendingPointing=true
        let h:EvidenceHandle;try{h=await this.evidence.resolve(input.reportId)}catch(e){this.pendingPointing=false;throw e}
        let submitted:FeedbackRecord|undefined,committing=false,commitSettled:Promise<void>|undefined,finishCommit:(()=>void)|undefined,deadline:AbortSignal|undefined
        try {
            if (!(await h.current())) throw new CapabilityError('STALE_SNAPSHOT', 'New feedback requires a current verified snapshot.')
            let existing: FeedbackRecord | undefined, candidate: RemapCandidate | undefined
            if (input.remapCandidateId) {
                existing = (await h.store.list()).feedback.find((f) => f.id === input.feedbackId)
                candidate = existing ? (remapCandidate(existing, h.report) ?? undefined) : undefined
                if (!candidate || candidate.id !== input.remapCandidateId) throw new CapabilityError('REMAP_NOT_AVAILABLE', 'Read a current, proven remap candidate first.')
            }
            const request = deadline=AbortSignal.timeout(ttl),
                active = signal ? AbortSignal.any([signal, request]) : request
            const result = await this.views.request(
                {
                    reportId: input.reportId,
                    prompt: input.prompt,
                    ttlMs: ttl,
                    candidate,
                    submit: async (anchor, text) => {
                        if (committing || submitted) throw new CapabilityError('POINT_ALREADY_SUBMITTED', 'This request has already committed.')
                        active.throwIfAborted()
                        committing = true;commitSettled=new Promise<void>(resolve=>{finishCommit=resolve})
                        try{
                        if (!(await h.current())) throw new CapabilityError('STALE_SNAPSHOT', 'Inputs changed before the point was committed.')
                        const generation = this.generation
                        await this.evidence.retain(h, false)
                        active.throwIfAborted()
                        let record: FeedbackRecord
                        if (existing && candidate) {
                            const current = (await h.store.list()).feedback.find((f) => f.id === existing!.id)
                            if (!current || current.recordRevision !== existing.recordRevision) throw new CapabilityError('STALE_REVIEW_REVISION', 'Feedback changed while confirming remap.')
                            record = { ...existing, status: 'open', anchor: acceptedRemap(existing.anchor, candidate, { ...existing.anchor.source, uri: anchor.source.uri, selector: anchor.source.selector }), history: [...existing.history, { at: Date.now(), action: 'user-confirmed-remap', fromSnapshotId: existing.anchor.snapshotId, toSnapshotId: h.report.snapshot.id, method: candidate.method }] }
                        } else record = { schemaVersion: 1, id: `cad-${randomUUID()}`, recordRevision: 0, ownerUri: h.ownerUri, status: 'open', text, anchor, history: [{ at: Date.now(), action: 'user-pointed' }], createdAt: Date.now(), updatedAt: Date.now() }
                        submitted = await h.store.putFeedback(record, existing?.recordRevision)
                        if (generation !== this.generation || !(await h.current())) {
                            await h.store.markStale(new Set([h.report.reportId]))
                            submitted = (await h.store.list()).feedback.find((f) => f.id === submitted!.id)!
                        }
                        this.changed.fire()
                        return submitted
                        }finally{finishCommit?.()}
                    },
                },
                active,
            )
            return { status: 'ACCEPTED', feedback: result }
        } catch (e) {
            await commitSettled
            if (submitted) return { status: 'ACCEPTED', feedback: submitted }
            if ((e as Error).name === 'TimeoutError'||deadline?.aborted&&!signal?.aborted) return { status: 'TIMED_OUT' }
            throw e
        } finally {
            this.pendingPointing = false
            h.release()
            if (!submitted && committing) await h.store.discardUnreferenced(h.report.reportId)
        }
    }
    async available() {
        const live = [...(this.cad.geometry?.core.all() ?? []), ...(this.cad.assembly?.core.all() ?? [])].map((r) => ({ reportId: r.reportId, ownerUri: r.snapshot.document.uri, label: `v${r.schemaVersion} ${r.overallStatus} · ${new Date(r.createdAt).toLocaleString()}` }))
        for (const store of await this.evidence.activeStores()) for (const b of (await store.list()).baselines) if (!live.some((r) => r.reportId === b.reportId)) live.push({ reportId: b.reportId, ownerUri: b.ownerUri, label: b.label ?? 'Retained baseline' })
        return live
    }
    async originalText(id: string) {
        const h = await this.evidence.resolve(id)
        try {
            return JSON.stringify({ current: await h.current(), ...h.report }, null, 2)
        } finally {
            h.release()
        }
    }
    async originalIssue(id: string, issueId: string, includeEvidence: boolean, cursor = 0, limit = 100) {
        const h = await this.evidence.resolve(id)
        try {
            const issue = h.report.issues.find((i) => i.id === issueId)
            if (!issue) throw new CapabilityError('ISSUE_NOT_FOUND', 'Issue does not belong to this frozen report.')
            const text = JSON.stringify(issue.spatial ?? { code: issue.code, title: issue.title })
            return { reportId: id, snapshotId: h.report.snapshot.id, current: await h.current(), issue, evidence: includeEvidence ? { text: text.slice(0, 8192), truncated: text.length > 8192, unavailable: ['unretained-cli-logs'] } : undefined, geometryEvidence: includeEvidence ? this.page<unknown>(h.report.schemaVersion === 3 ? (h.report.facts?.pairs ?? []) : (h.report.facts?.objects ?? []), cursor, limit) : undefined }
        } finally {
            h.release()
        }
    }
    async measure(input: import('../../core/mesh/types').MeshReference & { partIds?: string[]; measurementTypes?: string[]; objectOffset?: number; objectLimit?: number }) {
        const h = await this.evidence.resolve(input.reportId!)
        try {
            const r = h.report,
                requested = input.measurementTypes ?? ['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology'],
                offset = input.objectOffset ?? 0,
                limit = input.objectLimit ?? 20
            if (requested.some((k) => !['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology'].includes(k)) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new CapabilityError('INVALID_INPUT', 'Invalid measurements or pagination.')
            const quantity = (f: import('../../core/mesh/types').GeometryFacts | null) => Object.fromEntries(requested.map((k) => [k, k === 'topology' ? f?.objects.map((o) => ({ instanceId: o.instanceId, vertices: o.vertices, triangles: o.triangles, componentCount: o.componentCount, boundaryEdges: o.boundaryEdges, nonManifoldEdges: o.nonManifoldEdges, nonManifoldVertices: o.nonManifoldVertices, inconsistentEdges: o.inconsistentEdges, degenerateFaces: o.degenerateFaces, duplicateFaces: o.duplicateFaces })) : (f?.[k as 'bounds' | 'surfaceArea' | 'signedVolume' | 'physicalVolume'] ?? null)]))
            if (r.schemaVersion === 2) {
                if (input.partIds) throw new CapabilityError('PART_IDS_REQUIRE_ASSEMBLY', 'v2 has no stable part identity.')
                return { reportId: r.reportId, snapshotId: r.snapshot.id, current: await h.current(), overallStatus: r.overallStatus, units: r.units, precision: r.facts?.precision, values: quantity(r.facts), objects: { ...this.page(r.facts?.objects ?? [], offset, limit) }, incomplete: r.incomplete, notExamined: r.notExamined }
            }
            if (input.partIds?.some((id) => !r.snapshot.manifest?.parts.some((p) => p.id === id))) throw new CapabilityError('PART_NOT_FOUND', 'Unknown declared part identity.')
            const parts = r.facts?.parts.filter((p) => !input.partIds || input.partIds.includes(p.id)) ?? []
            const page=this.page(parts.map((p)=>({partId:p.id,local:quantity(p.local),assembly:quantity(p.world),matrix:p.matrix,physicalVolumeBound:p.volumeBound})),offset,limit)
            return {reportId:r.reportId,snapshotId:r.snapshot.id,current:await h.current(),overallStatus:r.overallStatus,units:r.units,precision:'based-on-frozen-exported-mesh',parts:page.items,total:page.total,offset:page.offset,nextOffset:page.nextOffset,
                assemblyPhysicalVolume: { status: 'UNRESOLVED', value: null, reason: 'UNION_VOLUME_NOT_CHECKED' },
                incomplete: r.incomplete,
            }
        } finally {
            h.release()
        }
    }
    async renderViews(input: import('../../core/mesh/types').RenderViewsInput & { partIds?: string[] }, signal?: AbortSignal) {
        const h = await this.evidence.resolve(input.reportId!)
        try {
            const inputs = await this.evidence.inputs(h, input.partIds),
                active = this.signal(signal),
                render = (await this.cad.geometry!.runGeometry((s) => reviewWorker({ operation: 'view', subjects: inputs, role: 'target' }, s), active)) as { world: Uint8Array }
            const decoded = readWorldArtifact(
                    render.world,
                    inputs.map((p) => p.id ?? '@document'),
                ),
                display = displayMesh(decoded),
                source = h.report.schemaVersion === 3 ? h.report.snapshot.sources[0]?.sourceReport : h.report
            if (!source || !display) return { reportId: h.report.reportId, snapshotId: h.report.snapshot.id, current: await h.current(), renderStatus: 'UNAVAILABLE' as const, reasonCode: 'MESH_DISPLAY_UNAVAILABLE', frames: [], delivery: 'metadata' as const, notExamined: ['visual-inspection', 'printability'] }
            const boxes = h.report.schemaVersion === 3 ? (h.report.facts?.parts.filter((p) => !input.partIds || input.partIds.includes(p.id)).flatMap((p) => (p.world.bounds ? [p.world.bounds] : [])) ?? []) : source.facts?.bounds ? [source.facts.bounds] : [],
                min = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]))) as [number, number, number],
                max = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k]))) as [number, number, number],
                bounds = boxes.length ? { min, max, dimensions: max.map((v, k) => v - min[k]) as [number, number, number] } : null
            const worldHash=createHash('sha256').update(render.world).digest('hex'),sourceHash=h.report.schemaVersion===2?(source.snapshot.meshSha256??source.artifacts.find(a=>a.role==='raw')?.sha256):h.report.artifacts.find(a=>a.mimeType==='application/vnd.scad-ai-ide.world-mesh')?.sha256
            const ref = await this.cad.geometry!.artifacts.put(h.report.snapshot.id, 'mesh', 'model/stl', display.bytes),
                release = this.cad.geometry!.artifacts.lease([ref.id])
            try {
                const view: import('../../core/mesh/types').MeshReport = { ...source, reportId: h.report.reportId, snapshot: { ...source.snapshot, id: h.report.snapshot.id, meshSha256: sourceHash??worldHash }, facts: source.facts ? { ...source.facts, bounds } : null, artifacts: [{ ...ref, role: 'render', derivation: { inputSha256: worldHash, numericType: 'float32', maxCoordinateError: display.maxCoordinateError } }] }
                const result = await this.cad.geometry!.images.render(view, input, active)
                return { ...result, current: await h.current(), partIds: input.partIds, sourceCoordinateFrame: h.report.schemaVersion === 3 ? 'assembly-world' : 'source-local' }
            } finally {
                release()
            }
        } finally {
            h.release()
        }
    }

    dispose() {
        clearTimeout(this.timer)
        this.tasks.dispose()
        this.views?.dispose()
        this.subscriptions.forEach((s) => s.dispose())
        this.changed.dispose()
    }
}
