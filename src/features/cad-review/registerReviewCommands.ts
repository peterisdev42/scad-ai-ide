import { confirmCapabilityAction } from '../../platform/notifications'
import * as vscode from 'vscode'
import type { ReviewWorkspaceService } from './ReviewWorkspaceService'
import type { CapabilityDispatcher } from '../../core/capabilities/CapabilityDispatcher'
export function registerReviewCommands(context: vscode.ExtensionContext, review: ReviewWorkspaceService, dispatcher: CapabilityDispatcher) {
    const choose = async (title: string) => {
        const values = await review.available()
        return (
            await vscode.window.showQuickPick(
                values.map((r) => ({ label: r.reportId, description: r.label, detail: r.ownerUri })),
                { title, placeHolder: 'Choose existing evidence; this does not compile a model.' },
            )
        )?.label
    }
    const run = async (id: string, input: Record<string, unknown>) =>
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CAD review', cancellable: true }, async (_, token) => {
            const abort = new AbortController(),
                sub = token.onCancellationRequested(() => abort.abort())
            try {
                const result = await dispatcher.invoke(id, input, { actor: 'command', signal: abort.signal })
                if (!result.ok) throw new Error(result.error.message)
                return result.data as Record<string, unknown>
            } finally {
                sub.dispose()
            }
        })
    context.subscriptions.push(
        vscode.commands.registerCommand('scad-ai-ide.model.openEvidence', async (id?: string) => {
            const reportId = id ?? (await choose('Open frozen CAD evidence'))
            if (reportId) await review.views!.open(reportId)
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.compare', async () => {
            const baselineReportId = await choose('Choose baseline evidence')
            if (!baselineReportId) return
            const targetReportId = await choose('Choose target evidence')
            if (!targetReportId) return
            const result = await run('cad.compare', { baselineReportId, targetReportId })
            await vscode.commands.executeCommand('scad-ai-ide.model.openReport', result.reportId)
            await review.views!.open(String(result.reportId))
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.getFeedback', async () => {
            const reportId = await choose('Read spatial feedback')
            if (!reportId) return
            const result = await run('cad.getFeedback', { reportId })
            const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(result, null, 2), language: 'json' })
            await vscode.window.showTextDocument(doc)
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.requestPointing', async () => {
            const reportId = await choose('Choose current evidence for human feedback')
            if (!reportId) return
            const prompt = await vscode.window.showInputBox({ title: 'Surface feedback request', prompt: 'The user will select a surface and explicitly save the annotation.', value: 'Please point at the surface to review.' })
            if (prompt) await run('cad.requestPointing', { reportId, prompt })
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.checkPrintability', async () => {
            const reportId = await choose('Choose frozen geometry to screen')
            if (!reportId) return
            const profiles = await vscode.window.showOpenDialog({ title: 'Choose explicit local print profile', canSelectMany: false, filters: { JSON: ['json'] } })
            if (!profiles?.length) return
            const h = await review.evidence.resolve(reportId)
            let partId: string | undefined
            try {
                if (h.report.schemaVersion === 3) {
                    partId = await vscode.window.showQuickPick(h.report.snapshot.manifest?.parts.map((p) => p.id) ?? [], { title: 'Choose a single part in its local coordinate frame' })
                    if (!partId) return
                }
            } finally {
                h.release()
            }
            const result = await run('cad.checkPrintability', { reportId, profileUri: profiles[0].toString(), ...(partId ? { partId } : {}) })
            await vscode.commands.executeCommand('scad-ai-ide.model.openReport', result.reportId)
        }),
        vscode.commands.registerCommand('scad-ai-ide.model.manageReview', async () => {
            const action = await vscode.window.showQuickPick(['retainBaseline', 'releaseBaseline', 'resolveFeedback', 'reopenFeedback', 'deleteFeedback'], { title: 'Manage local CAD review records' })
            if (!action) return
            if (action.endsWith('Baseline')) {
                const reportId = await choose('Choose frozen baseline evidence')
                if (reportId) await run('cad.manageReview', { action, reportId })
                return
            }
            const reportId = await choose('Choose feedback owner')
            if (!reportId) return
            const result = await run('cad.getFeedback', { reportId, limit: 100 }),
                records = result.items as Array<{ id: string; text: string; recordRevision: number; status: string }>,
                choice = await vscode.window.showQuickPick(
                    records.map((f) => ({ label: f.id, description: f.status, detail: f.text, recordRevision: f.recordRevision })),
                    { title: action },
                )
            if (choice) {
                if (action === 'deleteFeedback' && !(await confirmCapabilityAction('Delete saved feedback and unreferenced evidence', choice.label))) return
                await run('cad.manageReview', { action, feedbackId: choice.label, expectedRevision: choice.recordRevision })
            }
        }),
    )
}
