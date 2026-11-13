import { pairId } from './identity'
import type { AssemblyCheck, Interval, KernelResult, Manifest, CheckStatus } from './types'
export function rangeStatus(bound: Interval | null, min?: number, max?: number): CheckStatus {
    if (!bound) return 'UNRESOLVED'
    if ((min !== undefined && bound.upper < min) || (max !== undefined && bound.lower > max)) return 'FAIL'
    if ((min !== undefined && bound.lower < min) || (max !== undefined && bound.upper > max)) return 'UNRESOLVED'
    return 'PASS'
}
export function evaluate(manifest: Manifest, facts: KernelResult | null): AssemblyCheck[] {
    const parts = new Map(facts?.parts.map((p) => [p.id, p])),
        pairs = new Map(facts?.pairs.map((p) => [p.pairId, p]))
    const checks: AssemblyCheck[] = manifest.parts.map((p) => {
        const f = parts.get(p.id)
        return { id: `part:${p.id}:solid`, required: true, status: !f ? 'UNRESOLVED' : f.local.findings.some((i) => i.status === 'FAIL') || f.world.findings.some((i) => i.status === 'FAIL') || !f.local.rawTriangles ? 'FAIL' : f.local.physicalVolume.status === 'PASS' && f.world.physicalVolume.status === 'PASS' && f.local.complete && f.world.complete ? 'PASS' : 'UNRESOLVED', issueIds: [], reason: 'Every declared part must be a non-empty, valid raw solid.' }
    })
    for (const rule of manifest.checks) {
        const c: AssemblyCheck = { id: rule.id, required: rule.required !== false, status: 'UNRESOLVED', issueIds: [] },
            part = 'part' in rule ? parts.get(rule.part) : undefined
        if ('parts' in rule) {
            const p = pairs.get(pairId(...rule.parts))
            c.pairId = pairId(...rule.parts)
            c.relation = p?.relation ?? 'undetermined'
            if (!p?.complete || p.relation === 'undetermined') c.reason = p?.reason ?? 'PAIR_NOT_COMPLETED'
            else if (rule.type === 'relation') c.status = rule.allowed.includes(p.relation) ? 'PASS' : 'FAIL'
            else if (p.relation === 'overlap') {
                c.status = 'FAIL'
                c.reason = 'MATERIAL_OVERLAP'
            } else if (p.relation === 'contact' && !rule.allowContact) {
                c.status = 'FAIL'
                c.reason = 'CONTACT_FORBIDDEN'
            } else {
                c.status = rangeStatus(p.distanceBound, rule.min, rule.max)
                if (c.status === 'FAIL') c.relation = 'clearanceViolation'
            }
        } else if (rule.type === 'mesh-validity') c.status = checks.find((c) => c.id === `part:${rule.part}:solid`)?.status ?? 'UNRESOLVED'
        else if (rule.type === 'volume') {
            c.status = rangeStatus(part?.volumeBound ?? null, rule.min, rule.max)
            if (!part?.volumeBound) c.reason = 'CERTIFIED_PHYSICAL_VOLUME_UNAVAILABLE'
        } else if (rule.type === 'bounds') {
            const dimensions = rule.frame === 'assembly' ? part?.worldDimensions : part?.localDimensions,
                states = [0, 1, 2].map((k) => rangeStatus(dimensions?.[k] ?? null, rule.minDimensions?.[k], rule.maxDimensions?.[k]))
            c.status = states.includes('FAIL') ? 'FAIL' : states.includes('UNRESOLVED') ? 'UNRESOLVED' : 'PASS'
        }
        checks.push(c)
    }
    if (!manifest.checks.some((c) => c.required !== false)) checks.push({ id: 'declared-required-constraints', required: true, status: 'UNRESOLVED', reason: 'NO_REQUIRED_CONSTRAINTS', issueIds: [] })
    return checks
}
