import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const revision = 'fe482c342ea48bbe749563315741d0e58cdfd57f'
const directory = 'sources/openscad/src/core'
if (execFileSync('git', ['-C', 'sources/openscad', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) throw new Error('CSG compatibility baseline changed; review coverage before regenerating.')
// Capture the actual interchange serializers, including conditionally emitted
// fields. This is deliberately a source inventory, not a claim of full parity.
const serializers = []
for (const file of readdirSync(directory).filter((f) => f.endsWith('.cc'))) {
    const source = readFileSync(join(directory, file), 'utf8')
    const pattern = /std::string\s+(\w+)::toString\(\) const\s*\{/g
    for (const match of source.matchAll(pattern)) {
        let depth = 1,
            end = match.index + match[0].length
        for (; end < source.length && depth; end++) {
            if (source[end] === '{') depth++
            if (source[end] === '}') depth--
        }
        const body = source.slice(match.index, end)
        const parameters = [...new Set([...body.matchAll(/\b([a-z_][\w]*)\s*=\s*/g)].map((m) => m[1]).filter((p) => !['stream', 'path', 'index', 'i', 'j', 'point', 'first', 'outline', 'x', 'y', 'z'].includes(p)))].sort()
        serializers.push({ nodeClass: match[1], file, line: source.slice(0, match.index).split('\n').length, parameters, serializer: body })
    }
}
const source = readFileSync(join(directory, 'CurveDiscretizer.cc'), 'utf8')
const discretization = [...new Set([...source.matchAll(/\$(fn|fa|fs|fe)/g)].map((m) => m[0]))].sort()
const result = JSON.stringify({ revision, discretization, serializers }, null, 2) + '\n'
if (process.argv.includes('--check')) {
    if (readFileSync('src/core/csg/native/coverage.json', 'utf8') !== result) throw new Error('CSG serializer inventory is stale.')
} else writeFileSync('src/core/csg/native/coverage.json', result)
console.log(`${serializers.length} pinned serializers inventoried; curve fields: ${discretization.join(', ')}`)
