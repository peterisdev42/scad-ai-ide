import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const checker = 'customizer-architecture-check.mjs'
const fixture = 'fixtures/customizer-architecture-baseline.json'

function checkout(t) {
    const root = mkdtempSync(join(tmpdir(), 'customizer-architecture-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    execFileSync('git', ['init', '--quiet', root])
    mkdirSync(join(root, 'scripts/fixtures'), { recursive: true })
    mkdirSync(join(root, 'src/core/customizer'), { recursive: true })
    for (const file of [checker, fixture]) {
        copyFileSync(new URL(file, import.meta.url), join(root, 'scripts', file))
    }
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'junction')
    writeFileSync(join(root, 'src/core/customizer/one.ts'), 'export const one = 1\n')
    return root
}

function run(root) {
    return spawnSync(process.execPath, [join('scripts', checker)], { cwd: root, encoding: 'utf8' })
}

test('architecture check works without the historical Git object', t => {
    const root = checkout(t)
    const git = spawnSync('git', ['cat-file', '-e', '4463d61046d962a3f5afa5ace49b21f37e6cc4a6'], { cwd: root })
    assert.notEqual(git.status, 0)
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.coreFilesBefore, 7)
    assert.equal(summary.nonemptyLinesBefore, 812)
    assert.equal(summary.coreFilesAfter, 1)
})

for (const [name, corrupt, error] of [
    ['missing', file => rmSync(file), /ENOENT/],
    ['malformed JSON', file => writeFileSync(file, '{'), /SyntaxError/],
    ['unexpected source commit', (file, data) => writeFileSync(file, JSON.stringify({ ...data, sourceCommit: '0'.repeat(40) })), /source commit/],
    ['duplicate path', (file, data) => {
        data.files[1].path = data.files[0].path
        writeFileSync(file, JSON.stringify(data))
    }, /Duplicate Customizer baseline path/],
    ['inconsistent total', (file, data) => writeFileSync(file, JSON.stringify({ ...data, nonemptyLines: 0 })), /baseline line count mismatch/],
]) {
    test(`architecture check rejects a ${name} baseline`, t => {
        const root = checkout(t)
        const file = join(root, 'scripts', fixture)
        corrupt(file, JSON.parse(readFileSync(file, 'utf8')))
        const result = run(root)
        assert.equal(result.status, 1)
        assert.match(result.stderr, error)
    })
}

for (const dependency of ['vscode', 'node:fs', '../../features/customizer/host', '../../platform/customizer/host']) {
    test(`architecture check rejects host import ${dependency}`, t => {
        const root = checkout(t)
        writeFileSync(join(root, 'src/core/customizer/one.ts'), `import '${dependency}'\n`)
        const result = run(root)
        assert.equal(result.status, 1)
        assert.match(result.stderr, /Core host dependency/)
    })
}

test('architecture check rejects reachable import cycles', t => {
    const root = checkout(t)
    writeFileSync(join(root, 'src/core/customizer/one.ts'), "import './two'\n")
    writeFileSync(join(root, 'src/core/customizer/two.ts'), "export * from './one'\n")
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Runtime import cycle/)
})
