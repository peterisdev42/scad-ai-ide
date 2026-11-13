import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { digest, verdict } from './snapshot'
import type { CadExecutionResult, CadInputs, CadIssue, VerificationCheck, VerificationReport } from './types'

export async function createVerificationReport(input: CadInputs, result: CadExecutionResult, unresolved: string[], locate: (file: string) => Promise<string | undefined>): Promise<VerificationReport> {
    const snapshot = { ...input.snapshot, complete: input.snapshot.complete && !unresolved.length, unresolvedInputs: [...new Set(unresolved)] }
    const reportId = `cad-${randomUUID()}`,
        logId = `${reportId}:log`
    const issues: CadIssue[] = []
    for (const diagnostic of result.diagnostics) {
        let uri = snapshot.document.uri,
            exact = diagnostic.line !== undefined
        if (diagnostic.file && !['-', '<stdin>', 'stdin', basename(input.path)].includes(diagnostic.file)) {
            const file = isAbsolute(diagnostic.file) ? diagnostic.file : resolve(dirname(input.path), diagnostic.file)
            const located = await locate(file)
            if (located) uri = located
            else exact = false
        }
        if (uri !== snapshot.document.uri && !snapshot.dependencies.some((d) => d.uri === uri && !d.dirty)) {
            exact = false
            uri = snapshot.document.uri
        }
        const location = { uri, line: exact ? diagnostic.line! : 0, character: 0, confidence: exact ? ('exact' as const) : ('fallback' as const) }
        issues.push({ id: digest({ snapshot: snapshot.id, code: diagnostic.code, message: diagnostic.message, location }), code: diagnostic.code, title: exact ? diagnostic.message.replace(/\s+in file\s+.+?,?\s*(?:,\s*)?line\s+\d+.*$/i, '').trim() : diagnostic.message, severity: diagnostic.severity, status: diagnostic.incomplete ? 'UNRESOLVED' : 'FAIL', source: 'cli', location, relatedTrace: diagnostic.trace, evidenceIds: [logId], hint: diagnostic.incomplete ? 'Check the referenced library or symbol; no dependencies were installed.' : undefined })
    }
    if (unresolved.length && !issues.some((i) => i.status === 'UNRESOLVED')) issues.push({ id: digest({ snapshot: snapshot.id, unresolved }), code: 'SCAD_ANALYSIS_UNRESOLVED', title: `Model-level issue: ${unresolved.join(', ')}`, severity: 'warning', status: 'UNRESOLVED', source: 'cli', relatedTrace: [], evidenceIds: [logId] })
    if (result.status === 'TIMED_OUT' || result.status === 'CANCELLED') issues.push({ id: digest({ snapshot: snapshot.id, status: result.status }), code: `SCAD_CLI_${result.status}`, title: `OpenSCAD analysis ${result.status.toLowerCase()}. No verification PASS is available.`, severity: 'warning', status: 'UNRESOLVED', source: 'cli', relatedTrace: [], evidenceIds: [logId] })
    const checks: VerificationCheck[] = [{ id: 'cli-evaluation', category: 'compile', required: true, status: issues.some((i) => i.severity === 'error') ? 'FAIL' : result.status !== 'SUCCEEDED' || !snapshot.complete ? 'UNRESOLVED' : !input.hasGeometry ? 'SKIPPED' : 'PASS', issueIds: issues.map((i) => i.id), reason: !input.hasGeometry ? 'NOT_APPLICABLE: source contains only parameters/comments.' : input.snapshot.evaluation.mode === 'csg' ? 'CSG evaluation only; no full-mesh or assembly verification.' : 'Official full-mesh export only; no independent mesh or assembly verification.' }]
    const report: VerificationReport = { schemaVersion: 1, reportId, snapshot, executionStatus: result.status, overallStatus: verdict(result.status, checks, snapshot.complete), checks, issues, units: 'modelUnits', cliExitCode: result.exitCode, examined: snapshot.evaluation.mode === 'csg' ? ['cli-diagnostics'] : ['cli-diagnostics', 'full-render-export'], notExamined: [...(snapshot.evaluation.mode === 'csg' ? ['full-render'] : []), 'mesh-validity', 'dimensions', 'constraints', 'assembly', 'visual', 'diff', 'printability'], incomplete: snapshot.unresolvedInputs, artifacts: [{ id: logId, kind: 'log', mimeType: 'text/plain', snapshotId: snapshot.id }], metrics: { elapsedMs: result.elapsedMs, truncated: result.truncated } }
    return report
}
