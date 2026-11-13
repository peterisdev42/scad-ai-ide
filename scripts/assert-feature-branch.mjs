import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
assert.ok(branch && branch !== 'main', 'Code generation and CAD development writes require a named feature branch; main is read-only.')
console.log(`Feature branch guard: ${branch}`)
