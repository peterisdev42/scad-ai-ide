import type { MeshReport } from './types'
/** Bounded Agent projection. The readonly report retains all original evidence. */
export function meshReportSummary(report: MeshReport) {
    const facts = report.facts
    const summary = { schemaVersion: 2, reportId: report.reportId, snapshotId: report.snapshot.id, current: true, document: report.snapshot.document, inputKind: report.snapshot.inputKind, executionStatus: report.executionStatus, overallStatus: report.overallStatus, complete: report.snapshot.complete && !!facts?.complete, units: report.units, sourceUnit: report.snapshot.sourceUnit, quality: report.snapshot.quality, precision: facts?.precision, checks: report.checks.map((c) => ({ ...c, issueIds: c.issueIds.slice(0, 20) })), measurements: facts ? { bounds: facts.bounds, surfaceArea: facts.surfaceArea, signedVolume: facts.signedVolume, physicalVolume: facts.physicalVolume, objectCount: facts.objects.length, rawVertices: facts.rawVertices, rawTriangles: facts.rawTriangles } : null, issues: report.issues.slice(0, 20).map((i) => ({ id: i.id, code: i.code, status: i.status, title: i.title.slice(0, 1024), location: i.location })), issueCount: report.issueCount, issuesTruncated: report.issueCount > 20, examined: report.examined, notExamined: report.notExamined, incomplete: report.incomplete.slice(0, 20).map((s) => s.slice(0, 1024)), artifacts: report.artifacts, reportUri: `scad-cad-report:/${report.reportId}` }
    while (Buffer.byteLength(JSON.stringify(summary)) > 32768 && summary.issues.length) {
        summary.issues.pop()
        summary.issuesTruncated = true
    }
    if (Buffer.byteLength(JSON.stringify(summary)) > 32768) return { schemaVersion: 2, reportId: report.reportId, snapshotId: report.snapshot.id, overallStatus: report.overallStatus, complete: false, summaryTruncated: true, units: report.units, issueCount: report.issueCount, reportUri: summary.reportUri, notExamined: report.notExamined }
    return summary
}
