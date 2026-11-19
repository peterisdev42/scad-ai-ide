import assert from 'node:assert/strict'
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parseDocument } from 'yaml'
import { Ajv } from 'ajv'
import { adapters, groups, namespace, risks } from './metadata.mjs'

export const readText = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
export const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const paths = (root, glob) =>
    globSync(glob, { cwd: root })
        .map((file) => file.replaceAll('\\', '/'))
        .sort(compare)
const keyPattern = /^[a-z][\w-]*(?:\.[a-zA-Z][\w-]*)+$/
const identifier = /^[A-Za-z_$][\w$]*$/

function literal(node, file) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((value) => literal(value, file))
    if (ts.isObjectLiteralExpression(node)) {
        const entries = new Map()
        for (const property of node.properties) {
            assert.ok(ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)), `Expected a literal property in ${file}`)
            assert.ok(!entries.has(property.name.text), `Duplicate property ${property.name.text} in ${file}`)
            entries.set(property.name.text, literal(property.initializer, file))
        }
        return Object.fromEntries(entries)
    }
    throw new Error(`Expected static feature metadata in ${file}: ${node.getText()}`)
}

function readDeclaration(root, file) {
    const source = ts.createSourceFile(file, readText(path.join(root, file)), ts.ScriptTarget.Latest, true)
    assert.equal(source.parseDiagnostics.length, 0, `Invalid TypeScript in ${file}`)
    const [importStatement, declaration] = source.statements
    assert.ok(source.statements.length === 2 && ts.isImportDeclaration(importStatement) && ts.isExportAssignment(declaration) && ts.isCallExpression(declaration.expression), `Expected a single defineFeature declaration in ${file}`)
    assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(file), importStatement.moduleSpecifier.text)), 'src/ai/contracts/Feature', `Only the Feature contract may be imported by ${file}`)
    const call = declaration.expression
    assert.equal(call.arguments.length, 1, `Expected one descriptor in ${file}`)
    const descriptor = literal(call.arguments[0], file)
    assert.ok(Object.hasOwn(adapters, descriptor.kind) && call.expression.getText(source) === 'define' + descriptor.kind[0].toUpperCase() + descriptor.kind.slice(1), `Invalid feature kind in ${file}`)
    return descriptor
}

function checkUnique(entries, name) {
    const seen = new Map()
    for (const [value, id] of entries) {
        assert.ok(!seen.has(value), `Duplicate ${name} ${value}: ${seen.get(value)} and ${id}`)
        seen.set(value, id)
    }
}

export function collect(root) {
    const features = paths(root, 'src/ai/features/**/*.feature.ts').map((file) => readDeclaration(root, file))
    const ajv = new Ajv({ strict: true, allErrors: true })
    const resources = new Map(
        Object.entries(adapters)
            .filter(([, adapter]) => adapter.glob)
            .flatMap(([kind, adapter]) => paths(root, adapter.glob).map((file) => ['./' + file, kind])),
    )
    const tools = features.filter((feature) => feature.kind === 'tool')
    const toolReferences = new Set(tools.flatMap(({ tool }) => [tool.name, tool.referenceName, tool.capabilityId]))
    const bindings = new Map()
    const resourcePaths = new Set()
    const validators = new Map()
    for (const feature of features) {
        const { id, kind, group, control, display } = feature
        assert.match(id, keyPattern, `Invalid feature ID: ${id}`)
        assert.ok(id.startsWith(kind + '.') && id.split('.').length >= 3 && Object.hasOwn(groups, group), `Invalid feature identity: ${id}`)
        assert.ok(control?.scope === 'application' && typeof control.enabledByDefault === 'boolean' && typeof control.userConfigurable === 'boolean', `Invalid control: ${id}`)
        assert.ok(Number.isSafeInteger(display?.order), `Invalid display order: ${id}`)
        assert.ok(display.icon === undefined || /^[a-z][a-z0-9-]*$/.test(display.icon), `Invalid Codicon ID: ${id}`)
        assert.ok(feature.guidance === undefined || (['prompt', 'chatAgent'].includes(kind) && typeof feature.guidance === 'boolean'), `Invalid guidance policy: ${id}`)
        for (const list of [feature.dependencies?.allOf, feature.dependencies?.recommends]) {
            assert.ok(list === undefined || (Array.isArray(list) && list.every((dependency) => keyPattern.test(dependency)) && new Set(list).size === list.length), `Invalid dependency list: ${id}`)
        }
        assert.ok(feature.requiresTrust === undefined || typeof feature.requiresTrust === 'boolean', `Invalid Trust policy: ${id}`)
        feature.guidance = Boolean(adapters[kind].guidance || feature.guidance)
        if (kind === 'tool') {
            const { tool } = feature
            assert.ok(tool && keyPattern.test(tool.capabilityId), `Invalid capability ID: ${id}`)
            assert.ok(typeof tool.name === 'string' && typeof tool.referenceName === 'string' && typeof tool.modelDescription === 'string' && /^[\w-]+$/.test(tool.name) && /^[\w-]+$/.test(tool.referenceName) && tool.modelDescription, `Invalid Tool contribution: ${id}`)
            assert.ok(Object.hasOwn(risks, tool.risk), `Invalid Tool risk: ${id}`)
            assert.ok(tool.requiresInteraction === undefined || typeof tool.requiresInteraction === 'boolean', `Invalid interaction flag: ${id}`)
            assert.ok(tool.resultFormat === undefined || tool.resultFormat === 'inlineViews', `Invalid result format: ${id}`)
            if (['destructive', 'privileged'].includes(tool.risk)) assert.ok(tool.safetyReview?.trim(), `Missing safety review for ${id}`)
            assert.equal(tool.inputSchema?.type, 'object', `Expected object input schema for ${id}`)
            assert.ok(tool.serviceConfirmation === undefined || (tool.serviceConfirmation === true && tool.risk === 'change' && !tool.requiresInteraction), `Invalid service confirmation: ${id}`)
            try {
                validators.set(tool.capabilityId, ajv.compile(tool.inputSchema))
            } catch (error) {
                throw new Error(`Invalid input schema for ${id}: ${error.message}`)
            }
            const binding = tool.binding
            assert.ok(binding && /^src\/ai\/handlers\/(?:[\w-]+\/)*[\w-]+\.ts$/.test(binding.module) && identifier.test(binding.export), `Invalid binding for ${id}`)
            const file = path.join(root, binding.module)
            assert.ok(existsSync(file), `Missing binding module for ${id}: ${binding.module}`)
            assert.ok(realpathSync(file).startsWith(realpathSync(root) + path.sep), `Binding escapes extension root: ${id}`)
            const source = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true)
            const exportedHandler = source.statements.some((statement) => {
                if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false
                if (ts.isFunctionDeclaration(statement)) return !!statement.body && statement.name?.text === binding.export
                return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(({ name, initializer }) => name.getText(source) === binding.export && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)))
            })
            assert.ok(exportedHandler, `Missing binding export for ${id}: ${binding.export}`)
            bindings.set(tool.capabilityId, binding)
            delete tool.binding
        } else if (kind !== 'setting') {
            const resource = feature.resource?.path
            assert.equal(resources.get(resource), kind, `Resource missing or outside its contribution directory: ${id} (${resource})`)
            const file = path.join(root, resource)
            assert.ok(realpathSync(file).startsWith(realpathSync(root) + path.sep), `Resource escapes extension root: ${id}`)
            const content = readText(file)
            const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content)
            assert.ok(frontmatter, `Missing frontmatter: ${resource}`)
            const document = parseDocument(frontmatter[1], { schema: 'core' })
            assert.equal(document.errors.length, 0, `Invalid frontmatter: ${resource}: ${document.errors.join(', ')}`)
            const { name, description } = document.toJS({ maxAliasCount: 0 }) ?? {}
            assert.ok(typeof name === 'string' && name.trim() && typeof description === 'string' && description.trim(), `Missing name or description: ${resource}`)
            if (kind === 'skill') assert.equal(name, path.posix.basename(path.posix.dirname(resource)), `Skill name mismatch: ${resource}`)
            const references = content.matchAll(/(?:`(scad_ai_ide_\w+|scad_[a-z]+_[a-z0-9_]+)`|#(scad_[\w]+)|<!--\s*tool:\s*([\w.]+)\s*-->)/g)
            for (const [, toolName, promptReference, capabilityId] of references) {
                const reference = toolName ?? promptReference ?? capabilityId
                assert.ok(toolReferences.has(reference), `Unknown Tool in ${resource}: ${reference}`)
            }
            feature.resource = { path: resource, name, description }
            display.label ??= name
            display.summary ??= description
            resourcePaths.add(resource)
        } else {
            const setting = feature.setting
            assert.ok(setting?.key.startsWith(namespace + '.') && keyPattern.test(setting.key) && setting.description, `Invalid setting for ${id}`)
            const valid = setting.type === 'boolean' ? typeof setting.default === 'boolean' : setting.type === 'string' && Array.isArray(setting.enum) && new Set(setting.enum).size === setting.enum.length && setting.enum.every((value) => typeof value === 'string' && /^[\w-]+$/.test(value)) && [setting.default, setting.onValue, setting.offValue].every((value) => setting.enum.includes(value)) && setting.onValue !== setting.offValue
            assert.ok(valid, `Invalid setting values for ${id}`)
        }
        assert.ok(
            [display.label, display.summary].every((value) => typeof value === 'string' && value.trim()),
            `Invalid display text for ${id}`,
        )
        if (control.userConfigurable) feature.configKey = kind === 'setting' ? feature.setting.key : `${namespace}.agent.features.${id}.enabled`
    }
    checkUnique(
        features.map((f) => [f.id, f.id]),
        'feature ID',
    )
    checkUnique(
        tools.map((f) => [f.tool.capabilityId, f.id]),
        'capability ID',
    )
    checkUnique(
        tools.map((f) => [f.tool.name, f.id]),
        'tool name',
    )
    checkUnique(
        tools.map((f) => [f.tool.referenceName, f.id]),
        'tool reference',
    )
    checkUnique(
        features.filter((f) => f.resource).map((f) => [f.resource.path, f.id]),
        'resource path',
    )
    checkUnique(
        features.filter((f) => f.configKey).map((f) => [f.configKey, f.id]),
        'setting key',
    )
    for (const resource of resources.keys()) assert.ok(resourcePaths.has(resource), `Resource has no feature declaration: ${resource}`)
    const byId = new Map(features.map((feature) => [feature.id, feature]))
    const visited = new Set()
    const stack = new Set()
    function visit(feature) {
        if (visited.has(feature.id)) return
        assert.ok(!stack.has(feature.id), `Feature dependency cycle: ${[...stack, feature.id].join(' -> ')}`)
        stack.add(feature.id)
        for (const id of [...(feature.dependencies?.allOf ?? []), ...(feature.dependencies?.recommends ?? [])]) {
            assert.ok(byId.has(id), `Unknown dependency ${id} for ${feature.id}`)
            visit(byId.get(id))
        }
        stack.delete(feature.id)
        visited.add(feature.id)
    }
    features.forEach(visit)
    features.sort((a, b) => a.display.order - b.display.order || compare(a.id, b.id))
    return { features, bindings, validators, byId }
}
