import { Ajv } from 'ajv'
import { parseTree, getNodeValue, findNodeAtLocation, type ParseError } from 'jsonc-parser'
import schema from '../../../resources/schemas/cad-verification-v1.schema.json'
import { digest } from '../cad/snapshot'
import type { ConfigIssue, Manifest, Registry, Rule } from './types'
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema)
export { pairId } from './identity'
import { pairId } from './identity'
export function parseManifest(text: string): Registry {
    if (Buffer.byteLength(text) > 1048576) {
        const hash = digest(text)
        return { manifest: null, digest: hash, contentHash: hash, issues: [{ code: 'MANIFEST_BUDGET', message: 'Manifest exceeds 1 MiB.', pointer: '', offset: 0, length: 1 }] }
    }
    const contentHash = digest(text),
        errors: ParseError[] = [],
        tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false }),
        issues: ConfigIssue[] = []
    const add = (code: string, message: string, pointer = '') => {
        const node =
            tree &&
            findNodeAtLocation(
                tree,
                pointer
                    .split('/')
                    .slice(1)
                    .map((s) => (/^\d+$/.test(s) ? Number(s) : s.replace(/~1/g, '/').replace(/~0/g, '~'))),
            )
        issues.push({ code, message, pointer, offset: node?.offset ?? 0, length: node?.length ?? 1 })
    }
    if (Buffer.byteLength(text) > 1048576) {
        add('MANIFEST_BUDGET', 'Manifest exceeds 1 MiB.')
        return { manifest: null, digest: contentHash, contentHash, issues }
    }
    if (errors.length || !tree) {
        for (const e of errors.slice(0, 100)) issues.push({ code: 'MANIFEST_JSON', message: 'Invalid strict JSON.', pointer: '', offset: e.offset, length: e.length })
        return { manifest: null, digest: contentHash, contentHash, issues }
    }
    const value = getNodeValue(tree)
    if (!validate(value)) {
        for (const e of validate.errors?.slice(0, 100) ?? []) add('MANIFEST_SCHEMA', `${e.instancePath || '/'} ${e.message}`, e.instancePath)
        return { manifest: null, digest: contentHash, contentHash, issues }
    }
    const manifest = value as unknown as Manifest,
        ids = new Set<string>(),
        checks = new Set<string>()
    manifest.parts.forEach((p, i) => {
        if (ids.has(p.id)) add('DUPLICATE_PART_ID', `Duplicate part ${p.id}.`, `/parts/${i}/id`)
        ids.add(p.id)
        if (p.selector.type === 'define' && !p.selector.entry && !manifest.entry) add('PART_ENTRY_MISSING', 'Define selection requires a SCAD/CSG entry.', `/parts/${i}/selector`)
        p.transform = { translate: p.transform?.translate ?? [0, 0, 0], rotate: p.transform?.rotate ?? [0, 0, 0] }
    })
    const ranges = new Map<string, { min: number; max: number; at: number }>(),
        allowed = new Map<string, Set<string>>()
    manifest.checks.forEach((r, i) => {
        r.required ??= true
        if (checks.has(r.id)) add('DUPLICATE_CHECK_ID', `Duplicate check ${r.id}.`, `/checks/${i}/id`)
        checks.add(r.id)
        const targets = 'parts' in r ? r.parts : [r.part]
        for (const id of targets) if (!ids.has(id)) add('PART_NOT_FOUND', `Unknown part ${id}.`, `/checks/${i}`)
        if ('parts' in r && r.parts[0] === r.parts[1]) add('SELF_PAIR', 'A pair requires distinct parts.', `/checks/${i}/parts`)
        const interval = (key: string, min: number, max: number) => {
            if (min > max) add('CONTRADICTORY_CONSTRAINTS', 'Minimum exceeds maximum.', `/checks/${i}`)
            if (!r.required) return
            const prior = ranges.get(key)
            if (prior && Math.max(prior.min, min) > Math.min(prior.max, max)) {
                add('CONTRADICTORY_CONSTRAINTS', `Conflicts with check ${manifest.checks[prior.at].id}.`, `/checks/${i}`)
                add('CONTRADICTORY_CONSTRAINTS', `Conflicts with check ${r.id}.`, `/checks/${prior.at}`)
            }
            ranges.set(key, { min: Math.max(prior?.min ?? -Infinity, min), max: Math.min(prior?.max ?? Infinity, max), at: i })
        }
        if (r.type === 'clearance') {
            r.allowContact ??= false
            interval(pairId(...r.parts), r.min, r.max ?? Infinity)
            if (r.min === 0 && r.max === 0 && !r.allowContact) add('CONTRADICTORY_CONSTRAINTS', 'Zero-only clearance forbids contact.', `/checks/${i}`)
        }
        if (r.type === 'volume') {
            if (r.min === undefined && r.max === undefined) add('MISSING_RANGE', 'Volume needs a limit.', `/checks/${i}`)
            interval('volume:' + r.part, r.min ?? 0, r.max ?? Infinity)
        }
        if (r.type === 'bounds') {
            r.frame ??= 'local'
            if (!r.minDimensions && !r.maxDimensions) add('MISSING_RANGE', 'Bounds needs a limit.', `/checks/${i}`)
            for (let k = 0; k < 3; k++) interval(`bounds:${r.part}:${r.frame}:${k}`, r.minDimensions?.[k] ?? 0, r.maxDimensions?.[k] ?? Infinity)
        }
        if ('parts' in r && r.required) {
            const key = pairId(...r.parts),
                domain = new Set(r.type === 'relation' ? r.allowed : r.min === 0 && r.allowContact ? ['clear', 'contact'] : ['clear']),
                prior = allowed.get(key)
            const intersection = new Set([...domain].filter((v) => !prior || prior.has(v)))
            if (!intersection.size) add('CONTRADICTORY_CONSTRAINTS', 'Required relation domains do not intersect.', `/checks/${i}`)
            allowed.set(key, intersection)
        }
    })
    const normalized = {
        ...manifest,
        parts: [...manifest.parts].sort((a, b) => a.id.localeCompare(b.id)),
        checks: [...manifest.checks]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((r: Rule) => ('parts' in r ? { ...r, parts: [...r.parts].sort(), ...('allowed' in r ? { allowed: [...r.allowed].sort() } : {}) } : r)),
    }
    return { manifest: issues.length ? null : manifest, digest: digest(normalized), contentHash, issues }
}
