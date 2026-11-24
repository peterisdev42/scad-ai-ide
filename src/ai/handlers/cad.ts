import { boundedReviewSummary } from '../../core/review/summary'
import type { CadWorkspaceService } from '../../features/cad-verification/CadWorkspaceService'
import { meshReportSummary } from '../../core/mesh/summary'
import { reportSummary } from '../../core/cad/summary'
import { CapabilityError, type CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import { type ToolHandler } from '../contracts/ToolServices'

export const modelAnalyzeHandler: ToolHandler = async (input, ctx, { cad }) => {
    if (input.mode === 'verify') {
        ctx.report?.('Verifying the frozen raw mesh; no mesh repair is applied.')
        return meshReportSummary(await cad!.geometry!.verify(input as unknown as import('../../core/mesh/types').VerifyMeshInput, ctx.signal))
    }
    ctx.report?.('Evaluating official CLI diagnostics; geometry checks are not examined.')
    const report = await cad!.analyze(input as unknown as import('../../core/cad/CadVerificationService').AnalyzeInput, ctx.signal)
    ctx.report?.(`CLI diagnostics: ${report.overallStatus}`)
    return reportSummary(report)
}

export const modelEditBufferHandler: ToolHandler = (input, context, { cad }) => {
    if (!cad) throw new CapabilityError('UNAVAILABLE', 'CAD workspace service is unavailable.')
    return cad.bufferEdits.apply(input, context.signal)
}

export const modelPreviewLinkHandler: ToolHandler = (input, _context, { previewLinks }) => previewLinks.create(String(input.uri))

export const issueDetailsHandler: ToolHandler = async (input, _context, { cad }) => {
    const result = await cad!.issueDetails(String(input.reportId), String(input.issueId), input.includeEvidence === true, Number(input.cursor ?? 0), Number(input.limit ?? 100))
    return cad!.review?.has?.(String(input.reportId)) ? boundedReviewSummary(result) : result
}

export const modelMeasureHandler: ToolHandler = (input, ctx, { cad }) => {
    if (typeof input.reportId === 'string' && cad!.review && !cad!.assembly!.core.has(input.reportId) && !cad!.geometry!.core.has(input.reportId)) return cad!.review.measure(input as import('../../core/mesh/types').MeshReference & { partIds?: string[] })
    if (input.partIds && !(typeof input.reportId === 'string' && cad!.assembly!.core.has(input.reportId))) throw new CapabilityError('PART_IDS_REQUIRE_ASSEMBLY', 'partIds requires an existing v3 assembly report.')
    return typeof input.reportId === 'string' && cad!.assembly!.core.has(input.reportId) ? cad!.assembly!.measure(input as import('../../core/mesh/types').MeshReference) : cad!.geometry!.measure(input as import('../../core/mesh/types').MeshReference, ctx.signal)
}

export const modelRenderViewsHandler: ToolHandler = (input, ctx, { cad }) => {
    if (typeof input.reportId === 'string' && cad!.review && !cad!.assembly!.core.has(input.reportId) && !cad!.geometry!.core.has(input.reportId)) return cad!.review.renderViews(input as import('../../core/mesh/types').RenderViewsInput & { partIds?: string[] }, ctx.signal)
    if (input.partIds && !(typeof input.reportId === 'string' && cad!.assembly!.core.has(input.reportId))) throw new CapabilityError('PART_IDS_REQUIRE_ASSEMBLY', 'partIds requires an existing v3 assembly report.')
    return typeof input.reportId === 'string' && cad!.assembly!.core.has(input.reportId) ? cad!.assembly!.renderViews(input as import('../../core/mesh/types').RenderViewsInput, ctx.signal) : cad!.geometry!.renderViews(input as import('../../core/mesh/types').RenderViewsInput, ctx.signal)
}

export const listPartsHandler: ToolHandler = (input, _context, { cad }) => {
    return cad!.assembly!.list(input)
}

export const checkAssemblyHandler: ToolHandler = (input, ctx, { cad }) => {
    return cad!.assembly!.check(input, ctx.signal)
}

export const compareHandler: ToolHandler = async (input, ctx, { cad }) => {
    return boundedReviewSummary(await cad!.review!.compare(input, ctx.signal))
}

export const getFeedbackHandler: ToolHandler = async (input, _context, { cad }) => {
    return boundedReviewSummary(await cad!.review!.getFeedback(input))
}

export const requestPointingHandler: ToolHandler = (input, ctx, { cad }) => {
    return cad!.review!.requestPointing(input as unknown as Parameters<NonNullable<CadWorkspaceService['review']>['requestPointing']>[0], ctx.signal)
}

export const checkPrintabilityHandler: ToolHandler = async (input, ctx, { cad }) => {
    return boundedReviewSummary(await cad!.review!.print(input as unknown as Parameters<NonNullable<CadWorkspaceService['review']>['print']>[0], ctx.signal))
}

export const manageReviewHandler: ToolHandler = (input, _context, { cad }) => {
    return cad!.review!.manage(input as unknown as Parameters<NonNullable<CadWorkspaceService['review']>['manage']>[0])
}
