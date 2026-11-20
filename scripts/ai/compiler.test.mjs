import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Ajv } from 'ajv'
import { compile, checkOutputs } from './compiler.mjs'
import { readText } from './collect.mjs'
import { assertPublishedContract } from './assert-published-contract.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const generated = 'src/ai/generated/'
const catalogFile = generated + 'feature-catalog.generated.json'
const baseline = JSON.parse(readText(path.join(root, 'scripts/ai/published-contract.json')))

test('published 52/12/2 contracts match frozen names, schemas, risk, Markdown and settings', () => {
    const output = compile(root)
    checkOutputs(root, output, false)
    const { features } = JSON.parse(output[catalogFile])
    const manifest = JSON.parse(output['package.json']).contributes
    assertPublishedContract(features, manifest, file => readText(path.join(root, file)))
    const ajv = new Ajv({ strict: true })
    for (const file of ['ai-panel-state.schema.json', 'ai-preferences.schema.json']) assert.doesNotThrow(() => ajv.compile(JSON.parse(output[generated + file])))
})

const guiActions = JSON.parse(readText(path.join(root, 'src/core/capabilities/gui-actions.json')))
function withFixture(run) {
    const tmp = path.join(root, '.build')
    mkdirSync(tmp, { recursive: true })
    const dir = mkdtempSync(path.join(tmp, 'feature-contract-'))
    try {
        for (const source of new Set(['src/ai', 'skills', 'instructions', 'package.json', 'src/core/capabilities/gui-actions.json', 'src/core/capabilities/CapabilityTypes.ts', ...guiActions.map((group) => group.source)])) {
            const destination = path.join(dir, source)
            mkdirSync(path.dirname(destination), { recursive: true })
            cpSync(path.join(root, source), destination, { recursive: true })
        }
        run(dir)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

function write(dir, file, content) {
    const destination = path.join(dir, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, content)
}
function declare(dir, name, data) {
    const kind = data.kind[0].toUpperCase() + data.kind.slice(1)
    write(dir, 'src/ai/features/discovery/' + name + '.feature.ts', `import { define${kind} } from '../../contracts/Feature'\nexport default define${kind}(${JSON.stringify(data, null, 4)})\n`)
}
const base = { group: 'discovery', display: { label: 'Compiler fixture', summary: 'Example', order: 999 }, control: { enabledByDefault: true, userConfigurable: true, scope: 'application' } }
const fixtureTool = {
    ...base,
    kind: 'tool',
    id: 'tool.discovery.compilerFixture',
    tool: { capabilityId: 'test.compilerFixture', name: 'scad_ai_ide_compilerFixture', referenceName: 'scad_compilerFixture', modelDescription: 'Verify automatic discovery.', inputSchema: { type: 'object', additionalProperties: false }, risk: 'read', service: 'test', gui: 'none', binding: { module: 'src/ai/handlers/compiler-fixture.ts', export: 'run' } },
}

test('adding and removing declarations projects Tool, Skill, Instruction, Prompt and Custom Agent without editing a list', () =>
    withFixture((dir) => {
        const original = compile(dir)
        checkOutputs(dir, original, true)
        const handlerFile = fixtureTool.tool.binding.module
        write(dir, handlerFile, 'export const run = () => ({ ok: true })\n')
        declare(dir, 'compiler-tool', fixtureTool)
        const assets = [
            ['skill', 'skills/compiler-fixture/SKILL.md', 'chatSkills'],
            ['instruction', 'instructions/compiler-fixture.instructions.md', 'chatInstructions'],
            ['prompt', 'prompts/compiler-fixture.prompt.md', 'chatPromptFiles'],
            ['chatAgent', 'agents/compiler-fixture.agent.md', 'chatAgents'],
        ]
        for (const [kind, file] of assets) {
            write(dir, file, '---\nname: compiler-fixture\ndescription: Verify compiler discovery.\n---\nUse `scad_ai_ide_compilerFixture`.\n')
            declare(dir, 'compiler-' + kind, { ...base, kind, id: kind + '.discovery.compilerFixture', dependencies: { allOf: [fixtureTool.id] }, resource: { path: './' + file } })
        }
        const output = compile(dir)
        assert.throws(() => checkOutputs(dir, output, false), /Stale AI feature outputs.*\npackage.json/)
        checkOutputs(dir, output, true)
        assert.deepEqual(compile(dir), output)
        checkOutputs(dir, output, false)
        const manifest = JSON.parse(output['package.json']).contributes
        const c = manifest.languageModelTools.find((entry) => entry.name === fixtureTool.tool.name)
        assert.match(c.when, /config\.scad-ai-ide\.agent\.features\.tool\.discovery\.compilerFixture\.enabled/)
        assert.deepEqual(c.inputSchema.additionalProperties, { not: {} })
        const validateInput = new Ajv({ strict: true }).compile(c.inputSchema)
        assert.ok(validateInput({}))
        assert.equal(validateInput({ unexpected: true }), false)
        for (const [kind, file, contribution] of assets) {
            const resource = manifest[contribution].find((entry) => entry.path === './' + file)
            assert.ok(resource.when.includes(c.when.split(' && ').at(-1)), kind + ' must inherit hard dependency gate')
        }
        const catalog = JSON.parse(output[catalogFile])
        const newFeatures = catalog.features.filter((feature) => feature.id.endsWith('.compilerFixture'))
        assert.equal(newFeatures.length, 5)
        const settings = manifest.configuration.find((section) => section.id === 'scad-ai-ide.features').properties
        assert.ok(newFeatures.every((feature) => settings[feature.configKey]?.scope === 'application'))
        const validator = new Ajv().compile(JSON.parse(output[generated + 'ai-preferences.schema.json']))
        assert.ok(newFeatures.every((feature) => validator({ action: 'ai.setFeatureEnabled', featureId: feature.id, enabled: false })))
        assert.match(output[generated + 'feature-bindings.generated.ts'], /import .* from '..\/handlers\/compiler-fixture'/)
        write(
            dir,
            'src/ai/check-fixture.ts',
            `
        import assert from 'node:assert/strict'
        import { FeatureRegistry, featureCatalog } from './runtime/FeatureRegistry'
        import { FeaturePolicyEngine } from './runtime/FeaturePolicyEngine'
        import { run } from './handlers/compiler-fixture'

        const registry = new FeatureRegistry(featureCatalog)
        const features = Object.fromEntries(featureCatalog.features.map(feature => [feature.id, true]))
        const snapshot = () => ({ agentEnabled: true, guidanceEnabled: true,
            groups: Object.fromEntries(featureCatalog.groups.map(group => [group.id, true])),
            features, editorAssistance: {} })
        const policy = new FeaturePolicyEngine(registry, snapshot, {
            trusted: () => true, availability: () => ({ enabled: true }),
        })
        const featureId = 'tool.discovery.compilerFixture'
        policy.assertCanInvokeTool('test.compilerFixture', 'agent')
        assert.deepEqual(run(), { ok: true })
        features[featureId] = false
        assert.throws(() => policy.assertCanInvokeTool('test.compilerFixture', 'agent'), error => error.code === 'DISABLED_FEATURE')
        for (const kind of ['skill', 'instruction', 'prompt', 'chatAgent']) {
            assert.equal(policy.snapshot().state[kind + '.discovery.compilerFixture'].reasonCode, 'DISABLED_DEPENDENCY')
        }
    `,
        )
        const executable = path.join(dir, 'check-fixture.cjs')
        buildSync({ entryPoints: [path.join(dir, 'src/ai/check-fixture.ts')], bundle: true, platform: 'node', packages: 'external', outfile: executable })
        const run = spawnSync(process.execPath, [executable], { encoding: 'utf8' })
        assert.equal(run.status, 0, run.stderr)
        assert.equal(JSON.parse(original['package.json']).name, JSON.parse(output['package.json']).name)
        assert.deepEqual(JSON.parse(original['package.json']).contributes.commands, manifest.commands)
        assert.deepEqual(JSON.parse(original['package.json']).contributes.configuration[0], manifest.configuration[0])
        for (const file of globSync('src/ai/features/discovery/compiler-*.feature.ts', { cwd: dir })) rmSync(path.join(dir, file))
        for (const [, file] of assets) rmSync(path.join(dir, file))
        rmSync(path.join(dir, handlerFile))
        assert.throws(() => checkOutputs(dir, compile(dir), false), /Stale AI feature outputs/)
        assert.deepEqual(compile(dir), original)
        checkOutputs(dir, original, true)
        checkOutputs(dir, compile(dir), false)
    }))

test('invalid schemas, bindings, duplicate IDs/settings and cyclic or missing dependencies fail before writing', () =>
    withFixture((dir) => {
        const file = fixtureTool.tool.binding.module
        write(dir, file, 'export const run = () => ({})\n')
        const invalid = [
            [{ ...fixtureTool, tool: { ...fixtureTool.tool, inputSchema: { type: 'object', unknownKeyword: true } } }, /Invalid input schema.*compilerFixture/],
            [{ ...fixtureTool, tool: { ...fixtureTool.tool, binding: { module: file, export: 'missing' } } }, /Missing binding export/],
            [{ ...fixtureTool, dependencies: { allOf: ['tool.discovery.missing'] } }, /Unknown dependency/],
            [{ ...fixtureTool, dependencies: { allOf: [fixtureTool.id] } }, /dependency cycle/],
            [{ ...fixtureTool, id: 'tool.cad.modelAnalyze' }, /Duplicate feature ID/],
            [{ ...fixtureTool, tool: { ...fixtureTool.tool, name: 'scad_ai_ide_model_analyze' } }, /Duplicate tool name/],
            [{ ...base, kind: 'setting', id: 'setting.discovery.duplicate', setting: { key: 'scad-ai-ide.agent.enabled', type: 'boolean', default: true, description: 'Conflict' } }, /Duplicate managed setting/],
        ]
        for (const [feature, error] of invalid) {
            declare(dir, 'compiler-invalid', feature)
            assert.throws(() => compile(dir), error)
        }
        rmSync(path.join(dir, 'src/ai/features/discovery/compiler-invalid.feature.ts'))
        write(dir, 'skills/no-declaration/SKILL.md', '# Missing declaration')
        assert.throws(() => compile(dir), /Resource has no feature declaration/)
        declare(dir, 'compiler-skill', { ...base, kind: 'skill', id: 'skill.discovery.no-declaration', resource: { path: './skills/no-declaration/SKILL.md' } })
        assert.throws(() => compile(dir), /Missing frontmatter/)
    }))

test('CRLF inputs and generated artifacts retain byte-stable semantic outputs and stale checks are read-only', () =>
    withFixture((dir) => {
        const expected = compile(dir)
        checkOutputs(dir, expected, true)
        for (const file of [...globSync('src/ai/features/**/*.feature.ts', { cwd: dir }), ...Object.keys(expected), ...Object.keys(baseline.resources)]) {
            const absolute = path.join(dir, file)
            writeFileSync(absolute, readText(absolute).replaceAll('\n', '\r\n'))
        }
        assert.deepEqual(compile(dir), expected)
        checkOutputs(dir, expected, false)
        const absolute = path.join(dir, catalogFile)
        const stale = readFileSync(absolute, 'utf8').replace('Generated', 'Modified').replace('"schemaVersion": 1', '"schemaVersion": 2')
        writeFileSync(absolute, stale)
        assert.throws(() => checkOutputs(dir, expected, false), /feature-catalog\.generated\.json/)
        assert.equal(readFileSync(absolute, 'utf8'), stale)
    }))
