import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'

const baseline = '4463d61046d962a3f5afa5ace49b21f37e6cc4a6'
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
const graph = new Map()
const core = files.filter(file => file.startsWith('src/core/customizer/'))
for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const edges = []
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
        if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue
        if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue
        const specifier = statement.moduleSpecifier
        if (!specifier || !ts.isStringLiteral(specifier)) continue
        const name = specifier.text
        if (core.includes(file)) {
            assert.ok(name !== 'vscode' && !name.startsWith('node:') && !name.includes('/features/') && !name.includes('/platform/'), `Core host dependency: ${file} -> ${name}`)
        }
        if (name.startsWith('.')) {
            const stem = path.posix.normalize(path.posix.join(path.posix.dirname(file), name))
            const target = files.find(candidate => candidate === `${stem}.ts` || candidate === `${stem}/index.ts`)
            if (target) edges.push(target)
        }
    }
    graph.set(file, edges)
}
const visiting = new Set(), visited = new Set()
function visit(file, parents = []) {
    assert.ok(!visiting.has(file), `Runtime import cycle: ${[...parents, file].join(' -> ')}`)
    if (visited.has(file)) return
    visiting.add(file)
    for (const target of graph.get(file) ?? []) visit(target, [...parents, file])
    visiting.delete(file)
    visited.add(file)
}
for (const file of core) visit(file)
const count = text => text.split('\n').filter(line => line.trim()).length
const before = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'src/core/customizer'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const summary = {
    baseline,
    coreFilesBefore: before.length,
    coreFilesAfter: core.length,
    nonemptyLinesBefore: before.reduce((total, file) => total + count(execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })), 0),
    nonemptyLinesAfter: core.reduce((total, file) => total + count(readFileSync(file, 'utf8')), 0),
    coreRuntimeImportCycles: 0,
    coreHostDependencies: 0,
    reachableModulesChecked: visited.size,
}
console.log(JSON.stringify(summary, null, 2))
