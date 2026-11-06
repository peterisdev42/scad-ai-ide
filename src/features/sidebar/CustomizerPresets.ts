import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { encodePresetValue, parsePresetFile, presetOverrides, type PresetFile } from '../../core/customizer/CustomizerPresets'
import type { CustomizerService } from '../../core/customizer/CustomizerService'

interface Presets {
    uri?: vscode.Uri
    file: PresetFile
    active?: string
    error?: string
    baseline?: Record<string, string>
    exists: boolean
}

/** Owns preset file I/O; parameter validation and rendering stay in the shared service. */
export class CustomizerPresets implements vscode.Disposable {
    private readonly files = new Map<string, Presets>()
    private watcher?: vscode.FileSystemWatcher
    private target?: string
    private generation = 0
    private reloadGeneration = 0
    private disposed = false

    constructor(
        private readonly service: CustomizerService,
        private readonly changed: () => void,
    ) {}

    state() {
        const presets = this.target ? this.files.get(this.target) : undefined
        return {
            names: Object.keys(presets?.file.parameterSets ?? {}),
            active: presets?.active ?? '',
            modified: !!presets && this.modified(presets),
            filename: presets?.uri?.path.split('/').at(-1) ?? '',
            error: presets?.error,
            path: presets?.uri?.toString(),
            exists: presets?.exists ?? false,
        }
    }

    bind(target: string | undefined) {
        if (this.target === target) return
        this.target = target
        this.generation++
        this.watcher?.dispose()
        this.watcher = undefined
        if (!target) return
        if (!this.files.has(target)) this.files.set(target, { file: { fileFormatVersion: '1', parameterSets: {} }, exists: false })
        this.watch(target)
        void this.reload(target)
    }

    private watch(target: string) {
        this.watcher?.dispose()
        const uri = this.files.get(target)!.uri
        if (!uri) return
        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), posix.basename(uri.path)))
        this.watcher.onDidCreate(() => void this.reload(target))
        this.watcher.onDidChange(() => void this.reload(target))
        this.watcher.onDidDelete(() => void this.reload(target))
    }

    private async read(uri: vscode.Uri): Promise<{ file: PresetFile; exists: boolean }> {
        try {
            return { file: parsePresetFile(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')), exists: true }
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return { file: { fileFormatVersion: '1', parameterSets: {} }, exists: false }
            throw error
        }
    }

    private async reload(target: string) {
        const presets = this.files.get(target)!
        if (!presets.uri) return
        const generation = this.generation
        const reload = ++this.reloadGeneration
        try {
            const { file, exists } = await this.read(presets.uri)
            if (this.disposed || this.target !== target || generation !== this.generation || reload !== this.reloadGeneration) return
            const active = presets.active
            const reapply = active && !this.modified(presets) && JSON.stringify(presets.file.parameterSets[active]) !== JSON.stringify(file.parameterSets[active])
            presets.file = file
            presets.exists = exists
            presets.error = undefined
            if (active && !Object.hasOwn(file.parameterSets, active)) {
                presets.active = undefined
                presets.baseline = undefined
            } else if (active && reapply) this.apply(target, presets, active)
        } catch (error) {
            if (this.disposed || this.target !== target || generation !== this.generation || reload !== this.reloadGeneration) return
            presets.error = error instanceof Error ? error.message : String(error)
        }
        this.changed()
    }

    async execute(action: string, name?: string, explicitUri?: vscode.Uri, guard: () => void = () => {}) {
        const target = this.target
        const presets = target ? this.files.get(target) : undefined
        if (!target || !presets) throw new CapabilityError('TARGET_CHANGED', 'No Customizer target.')
        const generation = this.generation
        const current = () => !this.disposed && this.target === target && generation === this.generation
        if (action === 'select') {
            if (!name) {
                presets.active = undefined
                presets.baseline = undefined
                this.service.reset(undefined, 'preset')
            } else {
                this.apply(target, presets, name)
            }
        } else if (action === 'import') {
            const selected = explicitUri
            if (!selected || !current()) throw new CapabilityError('TARGET_CHANGED', 'Preset target changed.', true)
            const file = parsePresetFile(Buffer.from(await vscode.workspace.fs.readFile(selected)).toString('utf8'))
            if (!current()) throw new CapabilityError('TARGET_CHANGED', 'Preset target changed.', true)
            guard()
            presets.uri = selected
            presets.file = file
            presets.active = undefined
            presets.baseline = undefined
            presets.exists = true
            presets.error = undefined
            this.generation++
            this.watch(target)
            this.changed()
            return
        } else if (action === 'export') {
            const uri = explicitUri
            if (!uri || !current()) throw new CapabilityError('INVALID_PATH', 'An explicit preset file and current target are required.')
            const file = presets.uri ? (await this.read(presets.uri)).file : { fileFormatVersion: '1', parameterSets: {} as Record<string, Record<string, string>> }
            if (!current()) throw new CapabilityError('TARGET_CHANGED', 'Preset target changed.', true)
            if (!Object.keys(file.parameterSets).length) file.parameterSets.Current = this.snapshot()
            guard()
            await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(file, null, 2) + '\n'))
        } else if (action === 'new' || action === 'save' || action === 'delete') {
            if (action === 'save' && (!name || name === presets.active) && !this.modified(presets)) return
            const snapshot = this.snapshot()
            if (action === 'new') {
                if (!name || !current()) throw new CapabilityError('TARGET_CHANGED', 'A preset name and current target are required.', true)
                name = name.trim()
                if (!name) throw new CapabilityError('INVALID_INPUT', 'Enter a non-empty preset name.')
            } else name ??= presets.active
            if ((!name && action !== 'save') || !current()) return
            const source = vscode.Uri.parse(target)
            const inferred = source.scheme !== 'untitled' && /\.scad$/i.test(source.path) ? source.with({ path: source.path.replace(/\.scad$/i, '.json'), query: '', fragment: '' }) : undefined
            const uri = explicitUri ?? presets.uri ?? inferred
            if (!uri || !current()) throw new CapabilityError('INVALID_PATH', 'An explicit preset file and current target are required.')
            // Re-read before writing so unrelated presets and file metadata survive external edits.
            const { file } = await this.read(uri)
            if (!current()) throw new CapabilityError('TARGET_CHANGED', 'Preset target changed.', true)
            const creating = action === 'new' || (action === 'save' && !name)
            if (!name) {
                name = 'Current'
                let suffix = 2
                while (Object.hasOwn(file.parameterSets, name)) name = `Current ${suffix++}`
            }
            if (action === 'new' && Object.hasOwn(file.parameterSets, name)) throw new Error('A preset with this name already exists')
            if (!creating && !Object.hasOwn(file.parameterSets, name)) throw new Error('Preset no longer exists')
            if (action === 'delete') delete file.parameterSets[name]
            else file.parameterSets = { ...file.parameterSets, [name]: { ...file.parameterSets[name], ...snapshot } }
            this.reloadGeneration++
            guard()
            await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(file, null, 2) + '\n'))
            if (!current()) throw new CapabilityError('TARGET_CHANGED', 'Preset file was written, but the active model changed. Re-read before another action.', true)
            const openedNewFile = !presets.uri
            presets.uri = uri
            presets.file = file
            if (openedNewFile) this.watch(target)
            presets.active = action === 'delete' ? undefined : name
            presets.baseline = action === 'delete' ? undefined : snapshot
            presets.exists = true
            presets.error = undefined
        } else throw new CapabilityError('INVALID_INPUT', 'Unknown preset action.')
        if (current()) this.changed()
    }

    private modified(presets: Presets): boolean {
        return this.service.parameters.some((parameter) => {
            const baseline = presets.active && presets.baseline ? presets.baseline[parameter.name] : encodePresetValue(parameter.defaultValue)
            return baseline !== encodePresetValue(this.service.value(parameter))
        })
    }

    private apply(target: string, presets: Presets, name: string) {
        if (!Object.hasOwn(presets.file.parameterSets, name)) throw new Error('Preset no longer exists')
        const overrides = presetOverrides(this.service.parameters, presets.file.parameterSets[name])
        presets.active = name
        // An explicit selection must render even if the values match an earlier selection.
        this.service.replaceOverrides(target, { ...this.service.getOverrides(target), ...overrides }, 'preset')
        presets.baseline = this.snapshot()
    }

    private snapshot(): Record<string, string> {
        return Object.fromEntries(this.service.parameters.map((parameter) => [parameter.name, encodePresetValue(this.service.value(parameter))]))
    }

    dispose() {
        this.disposed = true
        this.generation++
        this.watcher?.dispose()
    }
}
