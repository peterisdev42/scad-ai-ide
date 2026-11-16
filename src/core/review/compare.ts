import { digest } from '../cad/snapshot'
import { evaluate } from '../assembly/constraints'
import { randomUUID } from 'node:crypto'
import type { ComparisonReport, ComparisonRow, ReviewIssue, SubjectDigest, VerificationEvidence } from './types'
function metrics(f: import('../mesh/types').GeometryFacts | null | undefined): Record<string, unknown> | null {
    return f ? { bounds: f.bounds, surfaceArea: f.surfaceArea, signedVolume: f.signedVolume, physicalVolume: f.physicalVolume, rawTriangles: f.rawTriangles, rawVertices: f.rawVertices, topology: { objects: f.objects.length, components: f.objects.reduce((n, o) => n + o.componentCount, 0), boundaryEdges: f.objects.reduce((n, o) => n + o.boundaryEdges, 0), nonManifoldEdges: f.objects.reduce((n, o) => n + o.nonManifoldEdges, 0) }, precision: f.precision } : null
}
export function owner(report: VerificationEvidence) {
    return report.snapshot.document.uri
}
function semanticRule(rule: unknown) {
    const { why: _why, ...rest } = rule as Record<string, unknown>
    return rest
}
export function compareReports(a: VerificationEvidence, b: VerificationEvidence, ad: SubjectDigest[], bd: SubjectDigest[], protectedIds: string[] = [], identity = { baseline: owner(a), target: owner(b) }): ComparisonReport {
    const incomplete: string[] = [],
        issues: ReviewIssue[] = [],
        rows: ComparisonRow[] = [],
        checks: ComparisonReport['checks'] = []
    const report: ComparisonReport = { kind: 'comparison', schemaVersion: 1, reportId: `cad-${randomUUID()}`, baselineReportId: a.reportId, targetReportId: b.reportId, baselineModelStatus:a.overallStatus,targetModelStatus:b.overallStatus,baselineSnapshotId: a.snapshot.id, targetSnapshotId: b.snapshot.id, ownerUri: identity.target, units: b.units, comparisonStatus: 'COMPLETE', regressionStatus: 'NO_REGRESSIONS_FOUND', rows, checks, issues, incomplete, expectUnchangedPartIds: protectedIds, createdAt: Date.now() }
    const problem = (code: string, title: string, partIds?: string[]) => {
        issues.push({ id: digest([report.reportId, code, partIds]), code, title, source: 'diff', status: 'FAIL', severity: 'error', location: { uri: identity.target, line: 0, character: 0, confidence: 'fallback' }, relatedTrace: [], evidenceIds: [], partIds })
    }
    if (a.schemaVersion !== b.schemaVersion || identity.baseline !== identity.target) incomplete.push('PART_IDENTITY_CHANGED')
    if (a.units !== b.units) incomplete.push('UNITS_INCOMPATIBLE')
    const sources = (r: VerificationEvidence) => (r.schemaVersion === 3 ? r.snapshot.sources.map((s) => s.sourceReport) : [r])
    const quality = (r: import('../mesh/types').MeshReport) => ({ runtime: r.snapshot.runtime, kernel: r.snapshot.kernelVersion, profile: r.snapshot.quality.profile, tessellation: r.snapshot.quality.requestedGlobalTessellation })
    const as = sources(a),
        bs = sources(b)
    if (a.schemaVersion === 2 && b.schemaVersion === 2 && digest(quality(a)) !== digest(quality(b))) incomplete.push('RUNTIME_OR_QUALITY_INCOMPATIBLE')
    if (a.schemaVersion === 3 && b.schemaVersion === 3)
        for (const s of a.snapshot.sources) {
            const other = b.snapshot.sources.find((t) => t.partId === s.partId)
            if (other && digest(quality(s.sourceReport)) !== digest(quality(other.sourceReport))) incomplete.push(`RUNTIME_OR_QUALITY_INCOMPATIBLE:${s.partId}`)
        }
    const identities = (r: VerificationEvidence): Array<string | null> => (r.schemaVersion === 3 ? (r.snapshot.manifest?.parts.map((p) => p.id) ?? []) : [null])
    if (protectedIds.length && (a.schemaVersion !== 3 || protectedIds.some((id) => !identities(a).includes(id)))) throw new Error('PART_IDENTITY_CHANGED: protected parts must exist in the baseline Manifest')
    const hardIncompatible = incomplete.length > 0
    if (!hardIncompatible) {
        for (const id of new Set([...identities(a), ...identities(b)])) {
            const x = ad.find((d) => d.id === id),
                y = bd.find((d) => d.id === id),
                xa = a.schemaVersion === 3 ? a.facts?.parts.find((p) => p.id === id) : undefined,
                ya = b.schemaVersion === 3 ? b.facts?.parts.find((p) => p.id === id) : undefined
            const geometryChanged = x && y ? x.geometryHash !== y.geometryHash : null,
                placementChanged = x && y ? (a.schemaVersion === 3 && b.schemaVersion === 3 ? digest(xa?.matrix) !== digest(ya?.matrix) : false) : null
            const status = !identities(a).includes(id) ? 'added' : !identities(b).includes(id) ? 'removed' : !x||!y ? 'unresolved' : geometryChanged || placementChanged ? 'changed' : 'unchanged'
            const row: ComparisonRow = { partId: id, status, geometryChanged, placementChanged, baseline: x, target: y, metrics: { baseline: metrics(a.schemaVersion === 2 ? a.facts : xa?.local), target: metrics(b.schemaVersion === 2 ? b.facts : ya?.local) }, protected: id !== null && protectedIds.includes(id) }
            rows.push(row)
            if ((!x && status !== 'added') || (!y && status !== 'removed')) incomplete.push('GEOMETRY_EVIDENCE_INCOMPLETE')
            if (row.protected && (!x || !y) && status !== 'removed') incomplete.push('PROTECTED_PART_NOT_PROVEN')
            if (row.protected && (status === 'changed' || status === 'removed')) problem('DIFF_PROTECTED_PART_CHANGED', `Protected part ${id} changed or is missing.`, [id!])
        }
    }
    const recheck = a.schemaVersion === 3 && b.schemaVersion === 3 && a.snapshot.manifest ? evaluate(a.snapshot.manifest, b.facts) : []
    const definitions = (r: VerificationEvidence) => (r.schemaVersion === 3 ? (r.snapshot.manifest?.checks ?? []) : [])
    for (const id of new Set([...a.checks.map((c) => c.id), ...b.checks.map((c) => c.id)])) {
        const x = a.checks.find((c) => c.id === id),
            y = b.checks.find((c) => c.id === id),
            old = definitions(a).find((c) => c.id === id),
            next = definitions(b).find((c) => c.id === id)
        const definitionChanged = !!old !== !!next || (!!old && digest(semanticRule(old)) !== digest(semanticRule(next))),
            required = !!x?.required || !!y?.required
        let transition = !x ? 'added' : !y ? 'removed' : x.status === y.status ? 'persistent' : x.status === 'PASS' && y.status === 'FAIL' ? 'regression' : y.status === 'PASS' ? 'recovered' : 'unresolved'
        if (definitionChanged) {
            transition = 'definition-changed'
            if (required) incomplete.push(`CONSTRAINT_BASELINE_CHANGED:${id}`)
        }
        if (!definitionChanged && required && x?.status === 'PASS' && y?.status === 'FAIL') problem('DIFF_REQUIRED_REGRESSION', `Required check ${id} regressed from PASS to FAIL.`)
        if (required && (((!x || !y) && !!(old || next)) || y?.status === 'UNRESOLVED' || y?.status === 'SKIPPED')) incomplete.push(`CHECK_NOT_COMPARABLE:${id}`)
        checks.push({ id, baseline: x?.status, target: y?.status, baselineRecheck: recheck.find((c) => c.id === id)?.status, definitionChanged, transition })
    }
    if (!a.snapshot.complete || !b.snapshot.complete || a.executionStatus !== 'SUCCEEDED' || b.executionStatus !== 'SUCCEEDED' || as.some((s) => !s.facts?.complete) || bs.some((s) => !s.facts?.complete)) incomplete.push('VERIFICATION_INCOMPLETE')
    report.comparisonStatus = hardIncompatible ? 'INCOMPATIBLE' : incomplete.length ? 'PARTIAL' : 'COMPLETE'
    report.regressionStatus = issues.length ? 'REGRESSIONS_FOUND' : incomplete.length || hardIncompatible ? 'UNRESOLVED' : 'NO_REGRESSIONS_FOUND'
    report.incomplete = [...new Set(incomplete)]
    return report
}
