import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { config as defaultConfig } from './config.mjs'

const absent = null
export const hash = (bytes) => (bytes === null ? null : createHash('sha256').update(bytes).digest('hex'))
const equal = (left, right) => hash(left) === hash(right)
const markers = /^(?:<{7}|={7}|>{7}|\|{7})(?: |$)/m
const canonicalStyle = { parser: 'typescript', singleQuote: true, tabWidth: 4, semi: false, trailingComma: 'all', printWidth: 1000000 }

export class PreviewSync {
    constructor(root, { config = defaultConfig, formatter, previewRoot } = {}) {
        this.root = path.resolve(root)
        this.config = config
        this.roots = Object.fromEntries(Object.entries(config.roots).map(([side, directory]) => [side, path.resolve(this.root, side === 'preview' && previewRoot ? previewRoot : directory)]))
        this.directory = path.join(this.root, '.preview-sync')
        this.formatter = formatter ?? createRequire(path.join(this.roots.ide, 'package.json'))('prettier')
    }
    configHash() {
        // Checkout locations are local configuration, not part of the sync protocol.
        const { roots, ...mapping } = this.config
        return hash(Buffer.from(JSON.stringify(mapping)))
    }
    async checkRoots() {
        for (const side of ['preview', 'ide']) {
            const manifest = await this.safe(side, 'package.json')
            try {
                if (!(await fs.stat(manifest)).isFile()) {
                    throw new Error('package.json 不是文件')
                }
            } catch (error) {
                throw new Error(`仓库未就绪，拒绝将缺失目录当作批量删除: ${this.config.roots[side]} (${error.message})`)
            }
        }
    }
    async initialize() {
        await this.checkRoots()
        try {
            await fs.access(path.join(this.directory, 'state.json'))
            throw new Error('同步基线已存在，不能重新初始化覆盖历史。')
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error
            }
        }
        await fs.mkdir(this.directory, { recursive: true })
        return this.locked(async () => {
            const pairs = await this.pairs()
            const state = { version: 1, formatter: this.formatter.version, config: this.configHash(), entries: {}, watched: {} }
            for (const pair of pairs) {
                state.entries[pair.preview] = { idePath: pair.ide }
                for (const side of ['preview', 'ide']) {
                    const raw = await this.read(side, pair[side])
                    state.entries[pair.preview][side] = await this.blob(await this.normalize(raw, pair, side))
                }
            }
            for (const side of ['preview', 'ide']) {
                state.watched[side] = {}
                for (const file of this.config.watch[side]) {
                    state.watched[side][file] = hash(await this.read(side, file))
                }
            }
            await this.atomic(path.join(this.directory, 'state.json'), Buffer.from(JSON.stringify(state, null, 2) + '\n'))
            return pairs.length
        })
    }
    async state() {
        await this.checkRoots()
        const bytes = await fs.readFile(path.join(this.directory, 'state.json'))
        const state = JSON.parse(bytes)
        if (state.version !== 1 || state.formatter !== this.formatter.version || state.config !== this.configHash()) {
            throw new Error('同步协议、Prettier 版本或映射配置变化；请先迁移基线，不能丢弃现有同步历史。')
        }
        return { state, digest: hash(bytes) }
    }
    async locked(work) {
        const file = path.join(this.directory, 'lock')
        const handle = await fs.open(file, 'wx').catch((error) => {
            throw new Error(`无法取得同步锁 ${file}: ${error.message}`)
        })
        try {
            return await work()
        } finally {
            await handle.close()
            await fs.unlink(file)
        }
    }
    async safe(side, relative) {
        if (!['preview', 'ide'].includes(side) || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === '..' || part === '.git')) {
            throw new Error(`非法同步路径: ${side}/${relative}`)
        }
        const base = this.roots[side]
        const target = path.resolve(base, relative)
        if (!target.startsWith(base + path.sep)) {
            throw new Error(`路径越界: ${relative}`)
        }
        // Never follow a symlink, including a linked checkout root.
        const parts = ['', ...path.relative(base, target).split(path.sep)]
        let current = base
        for (const part of parts) {
            current = path.join(current, part)
            try {
                if ((await fs.lstat(current)).isSymbolicLink()) {
                    throw new Error(`拒绝同步符号链接: ${current}`)
                }
            } catch (error) {
                if (error.code === 'ENOENT') {
                    break
                }
                throw error
            }
        }
        return target
    }
    async read(side, file) {
        const absolute = await this.safe(side, file)
        try {
            return await fs.readFile(absolute)
        } catch (error) {
            if (error.code === 'ENOENT') {
                return absent
            }
            throw error
        }
    }
    async pairs(state) {
        const found = new Map(this.config.files.map(([preview, ide]) => [preview, { preview, ide }]))
        const walk = async (side, relative, visit) => {
            const absolute = await this.safe(side, relative)
            let children
            try {
                children = await fs.readdir(absolute, { withFileTypes: true })
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return
                }
                throw error
            }
            for (const child of children) {
                const file = `${relative}/${child.name}`
                if (child.isSymbolicLink()) {
                    throw new Error(`拒绝同步符号链接: ${file}`)
                }
                if (child.isDirectory()) {
                    await walk(side, file, visit)
                } else if (child.isFile()) {
                    visit(file)
                }
            }
        }
        for (const [previewRoot, ideRoot] of this.config.trees) {
            await walk('preview', previewRoot, (file) => found.set(file, { preview: file, ide: ideRoot + file.slice(previewRoot.length) }))
            await walk('ide', ideRoot, (file) => {
                const preview = previewRoot + file.slice(ideRoot.length)
                found.set(preview, { preview, ide: file })
            })
        }
        for (const [preview, entry] of Object.entries(state?.entries ?? {})) {
            found.set(preview, { preview, ide: entry.idePath })
        }
        return [...found.values()].filter((pair) => !this.config.exclude.includes(pair.preview)).sort((a, b) => a.preview.localeCompare(b.preview))
    }
    async normalize(raw, pair, side) {
        if (raw === null || !pair.preview.endsWith('.ts')) {
            return raw
        }
        let text = raw.toString('utf8')
        if (side === 'preview' && this.config.files.some(([file]) => file === pair.preview) && pair.preview.startsWith('src/test/')) {
            text = text.replaceAll('../webview/', '../../features/preview/webview/')
        }
        return Buffer.from(await this.formatter.format(text, canonicalStyle))
    }
    async serialize(bytes, pair, side) {
        if (bytes === null || !pair.preview.endsWith('.ts')) {
            return bytes
        }
        let text = bytes.toString('utf8')
        if (side === 'preview' && pair.preview.startsWith('src/test/')) {
            text = text.replaceAll('../../features/preview/webview/', '../webview/')
        }
        const options = await this.formatter.resolveConfig(path.join(this.root, this.config.roots[side], pair[side]))
        return Buffer.from(await this.formatter.format(text, { ...options, parser: 'typescript' }))
    }
    async blob(bytes) {
        if (bytes === null) {
            return null
        }
        const id = hash(bytes)
        const file = path.join(this.directory, 'objects', id)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, bytes, { flag: 'wx' }).catch((error) => {
            if (error.code !== 'EEXIST') {
                throw error
            }
        })
        return id
    }
    async object(id) {
        if (id === null || id === undefined) {
            return null
        }
        if (!/^[a-f0-9]{64}$/.test(id)) {
            throw new Error('无效的基线对象')
        }
        const bytes = await fs.readFile(path.join(this.directory, 'objects', id))
        if (hash(bytes) !== id) {
            throw new Error(`基线对象损坏: ${id}`)
        }
        return bytes
    }
    async changes() {
        const { state } = await this.state()
        const rows = []
        for (const pair of await this.pairs(state)) {
            const entry = state.entries[pair.preview]
            const changed = {}
            for (const side of ['preview', 'ide']) {
                changed[`${side}Changed`] = hash(await this.normalize(await this.read(side, pair[side]), pair, side)) !== (entry?.[side] ?? null)
            }
            if (changed.previewChanged || changed.ideChanged) {
                rows.push({ ...pair, ...changed, file: pair.preview })
            }
        }
        const watched = await this.warnings(state)
        return { rows, watched }
    }
    async acknowledgeHost() {
        return this.locked(async () => {
            const { state } = await this.state()
            const warnings = await this.warnings(state)
            for (const side of ['preview', 'ide']) {
                for (const file of this.config.watch[side]) {
                    state.watched[side][file] = hash(await this.read(side, file))
                }
            }
            await this.atomic(path.join(this.directory, 'state.json'), Buffer.from(JSON.stringify(state, null, 2) + '\n'))
            return warnings.length
        })
    }
    async warnings(state) {
        const warnings = []
        for (const side of ['preview', 'ide']) {
            for (const file of this.config.watch[side]) {
                if (hash(await this.read(side, file)) !== state.watched[side][file]) {
                    warnings.push(`${side}: ${file}`)
                }
            }
        }
        return warnings
    }
    async merge(target, base, source) {
        if (equal(target, base) || equal(target, source)) {
            return { bytes: source, conflict: false }
        }
        if (equal(source, base)) {
            return { bytes: target, conflict: false }
        }
        if (target === null || base === null || source === null || [target, base, source].some((value) => value.includes(0))) {
            // Add/add, edit/delete and binary conflicts require an explicit choice.
            return { bytes: target ?? source, conflict: true }
        }
        const temp = await fs.mkdtemp(path.join(this.directory, 'merge-'))
        try {
            const paths = ['target', 'base', 'source'].map((file) => path.join(temp, file))
            await Promise.all(paths.map((file, index) => fs.writeFile(file, [target, base, source][index])))
            const merged = spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'TARGET', '-L', 'LAST_SOURCE_BASE', '-L', 'SOURCE', ...paths], { maxBuffer: 64 * 1024 * 1024 })
            if (merged.error || merged.status === null || merged.status > 127 || merged.status < 0) {
                throw merged.error ?? new Error(merged.stderr.toString())
            }
            return { bytes: merged.stdout, conflict: merged.status !== 0 }
        } finally {
            await fs.rm(temp, { recursive: true, force: true })
        }
    }
    async plan(direction) {
        if (!['to-ide', 'to-preview'].includes(direction)) {
            throw new Error('方向必须是 to-ide 或 to-preview')
        }
        return this.locked(async () => {
            const { state, digest } = await this.state()
            const sourceSide = direction === 'to-ide' ? 'preview' : 'ide'
            const targetSide = sourceSide === 'preview' ? 'ide' : 'preview'
            const id = randomUUID()
            const folder = path.join(this.directory, 'plans', id)
            await fs.mkdir(folder, { recursive: true })
            const plan = { version: 1, id, direction, sourceSide, targetSide, state: digest, entries: [], warnings: await this.warnings(state) }
            for (const pair of await this.pairs(state)) {
                const entry = state.entries[pair.preview]
                const sourceRaw = await this.read(sourceSide, pair[sourceSide])
                const source = await this.normalize(sourceRaw, pair, sourceSide)
                const base = await this.object(entry?.[sourceSide] ?? null)
                if (equal(source, base)) {
                    continue
                }
                const targetRaw = await this.read(targetSide, pair[targetSide])
                const target = await this.normalize(targetRaw, pair, targetSide)
                const targetBase = await this.object(entry?.[targetSide] ?? null)
                const working = await this.merge(target, base, source)
                const baseline = equal(target, targetBase) ? working : await this.merge(targetBase, base, source)
                const index = plan.entries.length
                const conflicts = []
                if (working.conflict) {
                    conflicts.push('working')
                }
                if (baseline.conflict) {
                    conflicts.push('baseline')
                }
                const same = equal(target, targetBase)
                for (const [name, bytes] of Object.entries({ source, base, target, 'target-base': targetBase, merged: working.bytes, baseline: baseline.bytes })) {
                    if (bytes !== null) {
                        await fs.writeFile(path.join(folder, `${index}.${name}`), bytes)
                    }
                }
                plan.entries.push({ pair, sourceRaw: hash(sourceRaw), targetRaw: hash(targetRaw), source: await this.blob(source), conflicts, resolved: false, skip: false, same, result: working.bytes === null ? 'delete' : 'file', baselineResult: baseline.bytes === null ? 'delete' : 'file' })
            }
            await fs.writeFile(path.join(folder, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
            return { plan, folder }
        })
    }
    async atomic(file, bytes) {
        if (bytes === null) {
            await fs.rm(file, { force: true })
            return
        }
        await fs.mkdir(path.dirname(file), { recursive: true })
        const temporary = `${file}.preview-sync-${randomUUID()}`
        try {
            await fs.writeFile(temporary, bytes)
            await fs.rename(temporary, file)
        } finally {
            await fs.rm(temporary, { force: true })
        }
    }
    async apply(id) {
        if (!/^[a-f0-9-]{36}$/.test(id)) {
            throw new Error('请提供计划 ID')
        }
        return this.locked(async () => {
            const folder = path.join(this.directory, 'plans', id)
            const plan = JSON.parse(await fs.readFile(path.join(folder, 'plan.json'), 'utf8'))
            const { state, digest } = await this.state()
            if (plan.state !== digest) {
                throw new Error('基线已变化，请重新生成同步计划。')
            }
            if (plan.version !== 1 || plan.id !== id || !['to-ide', 'to-preview'].includes(plan.direction) || plan.sourceSide !== (plan.direction === 'to-ide' ? 'preview' : 'ide') || plan.targetSide === plan.sourceSide || !['preview', 'ide'].includes(plan.targetSide)) {
                throw new Error('同步计划不合法')
            }
            const pairs = new Map((await this.pairs(state)).map((pair) => [pair.preview, pair]))
            const writes = []
            const seen = new Set()
            for (const [index, entry] of plan.entries.entries()) {
                if (entry.skip) {
                    continue
                }
                const pair = pairs.get(entry.pair.preview)
                if (!pair || pair.ide !== entry.pair.ide || seen.has(pair.preview)) {
                    throw new Error('同步计划包含非法或重复文件')
                }
                seen.add(pair.preview)
                const sourceRaw = await this.read(plan.sourceSide, pair[plan.sourceSide])
                const targetRaw = await this.read(plan.targetSide, pair[plan.targetSide])
                if (hash(sourceRaw) !== entry.sourceRaw || hash(targetRaw) !== entry.targetRaw) {
                    throw new Error(`计划生成后文件有变化，请重新生成: ${pair.preview}`)
                }
                if (hash(await this.normalize(sourceRaw, pair, plan.sourceSide)) !== entry.source) {
                    throw new Error('计划中的来源快照不匹配')
                }
                if (entry.conflicts.length && !entry.resolved) {
                    throw new Error(`尚未解决冲突: ${pair.preview}`)
                }
                const readResult = async (kind, action) => {
                    if (action === 'delete') {
                        return null
                    }
                    if (action !== 'file') {
                        throw new Error('无效的解决方式')
                    }
                    const bytes = await fs.readFile(path.join(folder, `${index}.${kind}`))
                    if (!bytes.includes(0) && markers.test(bytes.toString())) {
                        throw new Error(`冲突标记尚未清理: ${index}.${kind}`)
                    }
                    // Artifacts always use the canonical (IDE) import paths.
                    return this.normalize(bytes, pair, 'ide')
                }
                const result = await readResult('merged', entry.result)
                const baseline = entry.same ? result : await readResult('baseline', entry.baselineResult)
                const bytes = await this.serialize(result, pair, plan.targetSide)
                writes.push({ absolute: await this.safe(plan.targetSide, pair[plan.targetSide]), bytes, previous: targetRaw })
                const next = state.entries[pair.preview] ?? { idePath: pair.ide, preview: null, ide: null }
                next[plan.sourceSide] = entry.source
                next[plan.targetSide] = await this.blob(baseline)
                state.entries[pair.preview] = next
            }
            const applied = []
            try {
                for (const write of writes) {
                    applied.push(write)
                    await this.atomic(write.absolute, write.bytes)
                }
                if (writes.length) {
                    await this.atomic(path.join(this.directory, 'state.json'), Buffer.from(JSON.stringify(state, null, 2) + '\n'))
                }
            } catch (error) {
                for (const write of applied.reverse()) {
                    await this.atomic(write.absolute, write.previous)
                }
                throw error
            }
            return writes.length
        })
    }
}
