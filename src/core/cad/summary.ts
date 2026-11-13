import type { VerificationReport } from './types'

export function reportSummary(report: VerificationReport) {
    const summary = { schemaVersion: report.schemaVersion, reportId: report.reportId, snapshotId: report.snapshot.id, document: report.snapshot.document, projectRoot: report.snapshot.project.rootUri, runtime: report.snapshot.runtime, executionStatus: report.executionStatus, overallStatus: report.overallStatus, complete: report.snapshot.complete, units: report.units, checks: report.checks.map((check) => ({ ...check, issueIds: check.issueIds.slice(0, 20) })), issues: report.issues.slice(0, 20).map((issue) => ({ id: issue.id, code: issue.code, severity: issue.severity, status: issue.status, title: issue.title.slice(0, 1024), location: issue.location })), issueCount: report.issues.length, issuesTruncated: report.issues.length > 20, examined: report.examined, notExamined: report.notExamined, incomplete: report.incomplete.slice(0, 20).map((reason) => reason.slice(0, 1024)), artifacts: report.artifacts, metrics: report.metrics, reportUri: `scad-cad-report:/${report.reportId}` }
    while (Buffer.byteLength(JSON.stringify(summary)) > 32768 && summary.issues.length) {
        summary.issues.pop()
        summary.issuesTruncated = true
    }
    while (Buffer.byteLength(JSON.stringify(summary)) > 32768 && summary.incomplete.length) summary.incomplete.pop()
    if (summary.incomplete.length < report.incomplete.length) summary.incomplete.push('SUMMARY_TRUNCATED: open the report for all incomplete inputs.')
    if (Buffer.byteLength(JSON.stringify(summary)) > 32768) return { schemaVersion: report.schemaVersion, reportId: report.reportId, snapshotId: report.snapshot.id, executionStatus: report.executionStatus, overallStatus: report.overallStatus, complete: report.snapshot.complete, summaryTruncated: true, reportUri: summary.reportUri, notExamined: report.notExamined, issueCount: report.issues.length }
    return summary
}
