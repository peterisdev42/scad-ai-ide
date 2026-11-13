import type { MeshWorkspaceService } from './MeshWorkspaceService'
import { dependencyResolution } from '../../platform/openscad/dependencyResolution'
import { runtimeExecutableFiles } from '../../platform/openscad/runtimeIdentity'
import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import { createReadStream, watchFile, unwatchFile, type Stats } from 'node:fs'
import { readFile, realpath, readdir, stat, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { CadVerificationService, type AnalyzeInput } from '../../core/cad/CadVerificationService'
import { digest, identifySnapshot, sameSnapshotEvidence } from '../../core/cad/snapshot'
import type { CadDependency, CadInputs, CadParameters, VerificationReport } from '../../core/cad/types'
import type { CustomizerService } from '../../core/customizer/CustomizerService'
import { analyzeCustomizerSource } from '../../core/customizer/CustomizerSourceAnalyzer'
import { validateValue } from '../../core/customizer/CustomizerConstraints'
import { CapabilityError } from '../../core/capabilities/CapabilityTypes'
import { assertWorkspacePath } from '../../platform/WorkspacePaths'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { cadExecution, type ExecutionRequest } from '../../platform/openscad/CadExecutionService'
import type { registerRuntime } from '../runtime/registerRuntime'
import { PreviewSourceProblems } from '../preview/extension/services/PreviewSourceProblems'
import { canPreviewSource } from '../preview/extension/services/previewEligibility'

const within = (root: string, file: string) => {
    const part = relative(root, file)
    return part === '' || (part !== '..' && !part.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(part))
}
async function fileHash(file: string, maxBytes = 128 * 1048576) {
    const before = await stat(file, { bigint: true })
    if (before.size > BigInt(Math.max(0, maxBytes))) throw new CapabilityError('INPUT_TOO_LARGE', 'CAD input exceeds its byte budget.')
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of createReadStream(file)) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new CapabilityError('INPUT_TOO_LARGE', 'CAD input exceeds its byte budget.')
        hash.update(chunk)
    }
    const after = await stat(file, { bigint: true })
    const stamp = (info: typeof before) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
    if (stamp(before) !== stamp(after)) throw new CapabilityError('SNAPSHOT_CHANGED', 'CAD input changed while its content was being read.', true)
    return { hash: hash.digest('hex'), bytes, stamp: stamp(after) }
}

interface PreviewExecutionContext {
    parameters: CadParameters
    format: string
    lazyUnion?: boolean
    sourceTransport?: 'stdin' | 'file'
}

/** Extension Host adapter; no panel or active-editor state is needed for tools. */
export class CadWorkspaceService implements vscode.Disposable {
    geometry?: MeshWorkspaceService
    readonly verification: CadVerificationService
    private subscriptions: vscode.Disposable[] = []
    private watched = new Map<string, (current: Stats, previous: Stats) => void>()
    private resolutionPaths = new Map<string, string[]>()
    private reportWatchers = new Map<string, string[]>()
    private previewContexts = new Map<string, PreviewExecutionContext & { overridesDigest: string }>()
    private readonly reportChanged = new vscode.EventEmitter<vscode.Uri>()
    readonly onDidChangeReports = this.reportChanged.event
    private readonly staleReports = new Set<string>()
    private disposed = false
    private readonly runtimeHashes = new Map<string, { stamp: string; hash: string; bytes: number }>()
    private runtimeFiles: string[] = []
    private parameterDigests = new Map<string, string>()
    private requestControllers = new Set<AbortController>()
    constructor(
        private readonly runtime: ReturnType<typeof registerRuntime>,
        private readonly customizer: CustomizerService,
        readonly problems: PreviewSourceProblems,
    ) {
        this.verification = new CadVerificationService({
            capture: (uri, dependencies, projectRoot) => this.capture(uri, dependencies, projectRoot),
            execute: (input, signal) => {
                this.assertAvailable()
                return cadExecution.execute({ command: input.command, path: input.path, source: input.text, parameters: input.parameters, env: input.env, format: 'csg', signal, timeoutMs: this.timeout() })
            },
            locate: (file) => this.locate(file),
        })
        const invalidate = (uri?: vscode.Uri) => {
            this.geometry?.invalidate(uri)
            this.stale(uri?.toString())
            this.verification.invalidate(uri?.toString())
            if (uri) {
                this.problems.invalidate(uri)
                if (uri.scheme === 'file')
                    void realpath(uri.fsPath)
                        .then((path) => {
                            const canonical = vscode.Uri.file(path)
                            if (canonical.toString() !== uri.toString()) {
                                this.stale(canonical.toString())
                                this.verification.invalidate(canonical.toString())
                                this.problems.invalidate(canonical)
                            }
                        })
                        .catch(() => {})
            } else this.problems.invalidateAll()
        }
        let runtimeIdentity = JSON.stringify(runtime.getActiveRuntime())
        let runtimeWasInstalling = false
        this.subscriptions.push(
            vscode.workspace.onDidGrantWorkspaceTrust(() => invalidate()),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.contentChanges.length) {
                    if (/\/\.scad\/(?:verification|dependencies|dependencies\.lock|mounts)\.json$/i.test(e.document.uri.path)) invalidate()
                    else invalidate(e.document.uri)
                }
            }),
            vscode.workspace.onDidOpenTextDocument((d) => {
                if (d.uri.scheme === 'file') void this.problems.revalidate()
            }),
            vscode.workspace.onDidCloseTextDocument((d) => {
                this.verification.invalidate(d.uri.toString())
                void this.problems.revalidate()
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => invalidate()),
            vscode.workspace.onDidDeleteFiles((e) => e.files.forEach(invalidate)),
            vscode.workspace.onDidRenameFiles((e) =>
                e.files.forEach((f) => {
                    invalidate(f.oldUri)
                    invalidate(f.newUri)
                }),
            ),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('scad-ai-ide')) invalidate()
            }),
            libraryEnvironment.onDidChange(() => invalidate()),
            customizer.onDidChangeValues((target) => {
                const next = digest(customizer.getOverrides(target))
                if (this.parameterDigests.get(target) === next) return
                this.parameterDigests.set(target, next)
                invalidate(vscode.Uri.parse(target))
            }),
            runtime.onDidChange(() => {
                const state = runtime.getState()
                runtimeWasInstalling ||= !!state.installing
                if (state.busy || state.selectingId || state.installing || state.deletingId) return
                const next = JSON.stringify(runtime.getActiveRuntime())
                if (next !== runtimeIdentity || runtimeWasInstalling) invalidate()
                else void this.refreshValidity()
                runtimeIdentity = next
                runtimeWasInstalling = false
            }),
        )
    }
    private stale(uri?: string) {
        const reports = this.verification.reports.all()
        const ids = new Set(reports.map((r) => r.reportId))
        for (const id of this.staleReports) if (!ids.has(id)) this.staleReports.delete(id)
        for (const report of reports)
            if (!uri || report.snapshot.document.uri === uri || report.snapshot.dependencies.some((d) => d.uri === uri)) {
                this.staleReports.add(report.reportId)
                this.reportChanged.fire(vscode.Uri.from({ scheme: 'scad-cad-report', path: `/${report.reportId}` }))
            }
    }
    private timeout() {
        return vscode.workspace.getConfiguration('scad-ai-ide.verification').get<number>('cliTimeoutMs', 120000)
    }
    availability() {
        if (this.disposed) return { enabled: false, reasonCode: 'DISPOSED' }
        if (!vscode.workspace.getConfiguration('scad-ai-ide.verification').get<boolean>('enabled', true)) return { enabled: false, reasonCode: 'DISABLED' }
        if (!vscode.workspace.isTrusted) return { enabled: false, reasonCode: 'UNTRUSTED_WORKSPACE' }
        if (!this.runtime.getActiveRuntime()) return { enabled: false, reasonCode: 'RUNTIME_UNAVAILABLE' }
        return { enabled: true }
    }
    private assertAvailable() {
        const state = this.availability()
        if (!state.enabled) throw new CapabilityError(state.reasonCode!, 'CAD analysis is unavailable in the current host/workspace.')
    }
    private async locate(file: string): Promise<string | undefined> {
        try {
            const uri = vscode.Uri.file(file)
            await assertWorkspacePath(uri)
            await stat(file)
            return uri.toString()
        } catch {
            return undefined
        }
    }
    private async allowedRoots(source: string) {
        const roots = await Promise.all((vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => realpath(f.uri.fsPath)))
        for (const search of await libraryEnvironment.getSearchPaths(source)) {
            roots.push(await realpath(search))
            for (const name of await readdir(search)) {
                try {
                    roots.push(await realpath(join(search, name)))
                } catch {
                    /* Missing library mounts become unresolved inputs. */
                }
            }
        }
        // Inherited OPENSCADPATH is user configuration, never tool-controlled.
        const env = await libraryEnvironment.getEnvironment(source)
        const paths = Object.entries(env).find(([key]) => key.toUpperCase() === 'OPENSCADPATH')?.[1]
        for (const candidate of paths?.split(process.platform === 'win32' ? ';' : ':').filter(Boolean) ?? []) {
            try {
                roots.push(await realpath(resolve(dirname(source), candidate)))
            } catch {
                /* Actual missing references are reported by the CLI. */
            }
        }
        const active = this.runtime.getActiveRuntime()
        if (active?.installPath) {
            for (const candidate of [join(active.installPath, 'OpenSCAD.app', 'Contents', 'Resources', 'libraries'), join(active.installPath, 'share', 'openscad', 'libraries')]) {
                try {
                    roots.push(await realpath(candidate))
                } catch {
                    /* Platform-specific runtime library location. */
                }
            }
        }
        return roots
    }
    async capture(raw: string, dependencyPaths: string[], requestedRoot?: string, execution?: PreviewExecutionContext): Promise<CadInputs> {
        if (this.disposed) throw new CapabilityError('DISPOSED', 'CAD service has been disposed.')
        if (!vscode.workspace.isTrusted) throw new CapabilityError('UNTRUSTED_WORKSPACE', 'Trust this workspace to analyze OpenSCAD.')
        let uri = vscode.Uri.parse(raw, true)
        if (!/\.(scad|csg)$/i.test(uri.path)) throw new CapabilityError('INVALID_PATH', 'Choose a .scad or .csg document.')
        await assertWorkspacePath(uri)
        const root = await libraryEnvironment.resolveProjectRoot(uri.fsPath)
        if (!root) throw new CapabilityError('INVALID_PROJECT', 'Open the model inside a workspace project.')
        const rootUri = vscode.Uri.file(await realpath(root)).toString()
        try {
            if ((await lstat(join(root, '.scad'))).isSymbolicLink()) throw new CapabilityError('INVALID_PROJECT', 'The project .scad directory must not be a symbolic link.')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (requestedRoot) {
            const requested = vscode.Uri.parse(requestedRoot, true)
            await assertWorkspacePath(requested)
            if ((await realpath(requested.fsPath)) !== (await realpath(root))) throw new CapabilityError('INVALID_PROJECT', 'projectRoot does not match the model project.')
        }
        const runtime = this.runtime.getActiveRuntime()
        if (!runtime) throw new CapabilityError('RUNTIME_UNAVAILABLE', 'Select an OpenSCAD runtime.')
        let document = vscode.workspace.textDocuments.find((d) => !d.isClosed && d.uri.toString() === uri.toString())
        const sourceCanonical = await realpath(uri.fsPath)
        if (!document)
            for (const open of vscode.workspace.textDocuments.filter((d) => !d.isClosed && d.uri.scheme === 'file')) {
                try {
                    const canonical = await realpath(open.uri.fsPath)
                    if ((process.platform === 'win32' ? canonical.toLowerCase() : canonical) === (process.platform === 'win32' ? sourceCanonical.toLowerCase() : sourceCanonical)) {
                        document = open
                        break
                    }
                } catch {
                    /* A deleted open document cannot be this CLI input. */
                }
            }
        uri = document?.uri ?? vscode.Uri.file(sourceCanonical)
        if (!document && (await stat(uri.fsPath)).size > 8 * 1048576) throw new CapabilityError('INPUT_TOO_LARGE', 'SCAD source exceeds 8 MiB.')
        const text = document?.getText() ?? (await readFile(uri.fsPath, 'utf8'))
        if (Buffer.byteLength(text) > 8 * 1048576) throw new CapabilityError('INPUT_TOO_LARGE', 'SCAD source exceeds 8 MiB.')
        const unresolvedInputs: string[] = []
        const overrides = this.customizer.getOverrides(uri.toString())
        this.parameterDigests.delete(uri.toString())
        this.parameterDigests.set(uri.toString(), digest(overrides))
        while (this.parameterDigests.size > 128) this.parameterDigests.delete(this.parameterDigests.keys().next().value!)
        if (Object.keys(overrides).length) {
            const analysis = analyzeCustomizerSource(text)
            for (const [name, value] of Object.entries(overrides)) {
                const parameter = analysis.parameters.find((p) => p.name === name)
                if (!analysis.complete || !parameter || validateValue(parameter, value)) unresolvedInputs.push(`CUSTOMIZER_OVERRIDE_INVALID:${name}`)
            }
        }
        const parameters = execution?.parameters ?? { $preview: false, ...overrides }
        const env = await libraryEnvironment.getEnvironment(uri.fsPath)
        const roots = await this.allowedRoots(uri.fsPath)
        const dependencies: CadDependency[] = []
        const fileStamps: Record<string, string> = {}
        if (execution?.sourceTransport === 'file') {
            const disk = await fileHash(uri.fsPath, 8 * 1048576)
            if (disk.hash !== digest(text)) throw new CapabilityError('SNAPSHOT_CHANGED', 'The clean buffer and disk source differ; refresh before rendering.', true)
            fileStamps[uri.fsPath] = disk.stamp
        }
        const openDependencies = new Map<string, vscode.TextDocument>()
        for (const open of vscode.workspace.textDocuments.filter((d) => !d.isClosed && d.uri.scheme === 'file')) {
            try {
                openDependencies.set(await realpath(open.uri.fsPath), open)
            } catch {
                /* Deleted/open transient documents are not CLI inputs. */
            }
        }
        let bytes = 0
        for (const file of [...new Set(dependencyPaths)].sort()) {
            const dependencyUri = vscode.Uri.file(file).toString()
            try {
                const canonical = await realpath(file)
                if (!roots.some((root) => within(root, canonical))) throw new Error('DEPENDENCY_OUTSIDE_ALLOWED_ROOTS')
                const result = await fileHash(file, Math.min(128 * 1048576, 256 * 1048576 - bytes))
                bytes += result.bytes
                fileStamps[file] = result.stamp
                const open = openDependencies.get(canonical)
                const dirty = !!open?.isDirty && digest(open.getText()) !== result.hash
                dependencies.push({ uri: dependencyUri, sha256: result.hash, status: 'resolved', dirty })
                if (dirty) unresolvedInputs.push(`DIRTY_DEPENDENCY_NOT_EVALUATED:${dependencyUri}`)
            } catch (error) {
                dependencies.push({ uri: dependencyUri, status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable', dirty: false })
                unresolvedInputs.push(`DEPENDENCY_UNAVAILABLE:${dependencyUri}`)
            }
        }
        const resolutionSources = [{ path: sourceCanonical, text }]
        for (const dependency of dependencies.filter((d) => d.status === 'resolved')) {
            const path = await realpath(vscode.Uri.parse(dependency.uri).fsPath)
            if ((await stat(path)).size > 8 * 1048576) {
                unresolvedInputs.push('DEPENDENCY_RESOLUTION_SOURCE_LIMIT')
                continue
            }
            resolutionSources.push({ path, text: await readFile(path, 'utf8') })
        }
        const resolution = await dependencyResolution(resolutionSources, roots, (path) => roots.some((root) => within(root, path)))
        unresolvedInputs.push(...resolution.unresolved)
        this.resolutionPaths.delete(uri.toString())
        this.resolutionPaths.set(uri.toString(), resolution.paths)
        while (this.resolutionPaths.size > 128) this.resolutionPaths.delete(this.resolutionPaths.keys().next().value!)
        const constraintsPath = join(root, '.scad', 'verification.json')
        let constraintsDigest = 'missing'
        const libraryDrafts: Array<{ uri: string; sha256: string }> = []
        for (const open of vscode.workspace.textDocuments.filter((d) => !d.isClosed && d.uri.scheme === 'file' && d.isDirty)) {
            const file = open.uri.fsPath
            if (['dependencies.json', 'dependencies.lock.json', 'mounts.json'].some((name) => resolve(file) === resolve(root, '.scad', name))) {
                libraryDrafts.push({ uri: open.uri.toString(), sha256: digest(open.getText()) })
                unresolvedInputs.push(`DIRTY_LIBRARY_CONFIGURATION_NOT_APPLIED:${open.uri.toString()}`)
            }
        }
        try {
            await assertWorkspacePath(vscode.Uri.file(constraintsPath))
            const open = vscode.workspace.textDocuments.find((d) => !d.isClosed && d.uri.scheme === 'file' && resolve(d.uri.fsPath) === resolve(constraintsPath))
            constraintsDigest = open ? digest(open.getText()) : (await fileHash(constraintsPath, 1048576)).hash
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unresolvedInputs.push('CONSTRAINTS_UNREADABLE')
        }
        const runtimeIdentity = await runtimeExecutableFiles(runtime.command)
        this.runtimeFiles = runtimeIdentity.files
        if (!runtimeIdentity.complete) unresolvedInputs.push('RUNTIME_IDENTITY_INCOMPLETE: select the actual OpenSCAD binary for strict verification')
        const binaries = []
        for (const file of runtimeIdentity.files) {
            const info = await stat(file, { bigint: true })
            const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
            const cached = this.runtimeHashes.get(file)
            const identity = cached?.stamp === stamp ? cached : await fileHash(file, 256 * 1048576)
            this.runtimeHashes.delete(file)
            this.runtimeHashes.set(file, identity)
            while (this.runtimeHashes.size > 16) this.runtimeHashes.delete(this.runtimeHashes.keys().next().value!)
            binaries.push({ file, hash: identity.hash })
            fileStamps[file] = identity.stamp
        }
        const snapshot = identifySnapshot({ schemaVersion: 1, document: { uri: uri.toString(), version: document?.version, sourceSha256: digest(text), dirty: !!document?.isDirty }, project: { rootUri, libraryEnvironmentHash: digest({ project: await libraryEnvironment.getDependencyFingerprint(uri.fsPath), environment: env, libraryDrafts }), dependencyResolutionHash: resolution.hash }, dependencies, runtime: { executable: runtime.command.executable, version: runtime.version, identityHash: digest({ command: runtime.command, binaries, version: runtime.version }), capabilityHash: await cadExecution.capabilityHash(runtime.command), hostPlatform: `${process.platform}-${process.arch}` }, parameters: { overrides: parameters, digest: digest(parameters) }, evaluation: { sourceTransport: execution?.sourceTransport ?? 'stdin', mode: !execution || execution.format === 'csg' ? 'csg' : 'full-mesh', exportFormat: (execution?.format ?? 'csg') as 'csg' | 'stl' | '3mf' | 'png', settingsHash: digest({ format: execution?.format ?? 'csg', lazyUnion: execution?.lazyUnion ?? false, cliTimeoutMs: this.timeout() }) }, constraintsDigest, kernelVersion: 'diagnostics-v1', complete: !unresolvedInputs.length, unresolvedInputs })
        return { snapshot, fileStamps, path: uri.fsPath, text, hasGeometry: canPreviewSource(text), command: runtime.command, env, parameters }
    }
    async current(report: VerificationReport) {
        try {
            // Event notifications can arrive after a new report was published. Capture remains
            // authoritative for both complete and unresolved historical evidence.
            if (!this.availability().enabled) return false
            const context = this.previewContexts.get(report.reportId)
            if (context && context.overridesDigest !== digest(this.customizer.getOverrides(report.snapshot.document.uri))) return false
            const input = await this.capture(
                report.snapshot.document.uri,
                report.snapshot.dependencies.map((d) => vscode.Uri.parse(d.uri).fsPath),
                report.snapshot.project.rootUri,
                context,
            )
            return sameSnapshotEvidence(input.snapshot, report.snapshot)
        } catch {
            return false
        }
    }
    trackGeometryInputs(snapshot: import('../../core/cad/types').CadSnapshot) {
        this.watch({ snapshot })
    }
    watchGeometryFiles(uri: string, paths: string[]) {
        this.registerWatchedPaths(uri, paths)
    }
    notifyGeometryReports() {
        for (const doc of vscode.workspace.textDocuments) if (doc.uri.scheme === 'scad-cad-report') this.reportChanged.fire(doc.uri)
    }
    private watch(report: Pick<VerificationReport, 'snapshot'>) {
        const root = vscode.Uri.parse(report.snapshot.project.rootUri).fsPath
        const paths = [...(this.resolutionPaths.get(report.snapshot.document.uri) ?? []), ...this.runtimeFiles, vscode.Uri.parse(report.snapshot.document.uri).fsPath, ...report.snapshot.dependencies.map((d) => vscode.Uri.parse(d.uri).fsPath), report.snapshot.runtime.executable, join(root, '.scad'), join(root, '.scad', 'lib'), ...['dependencies.json', 'dependencies.lock.json', 'mounts.json', 'verification.json'].map((file) => join(root, '.scad', file))]
        this.registerWatchedPaths(report.snapshot.document.uri, paths)
    }
    private registerWatchedPaths(uri: string, paths: string[]) {
        this.reportWatchers.delete(uri)
        this.reportWatchers.set(uri, paths)
        while (this.reportWatchers.size > 128) this.reportWatchers.delete(this.reportWatchers.keys().next().value!)
        const wanted = new Set([...this.reportWatchers.values()].flat().slice(0, 4096))
        for (const [file, listener] of this.watched)
            if (!wanted.has(file)) {
                unwatchFile(file, listener)
                this.watched.delete(file)
            }
        for (const file of wanted)
            if (!this.watched.has(file)) {
                const listener = (current: Stats, previous: Stats) => {
                    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size && current.ctimeMs === previous.ctimeMs && current.ino === previous.ino) return
                    // Polling delivery can lag behind a fresh capture. Revalidate facts instead of
                    // cancelling a new task which already captured this disk change. Executions
                    // still compare content, evidence and filesystem stamps before publication.
                    void this.refreshValidity()
                    this.geometry?.refreshFileValidity()
                    const roots = new Set([...this.reportWatchers].filter(([, paths]) => paths.includes(file)).map(([root]) => root))
                    for (const report of this.verification.reports.all()) if (roots.has(report.snapshot.document.uri)) this.reportChanged.fire(vscode.Uri.from({ scheme: 'scad-cad-report', path: `/${report.reportId}` }))
                }
                watchFile(file, { persistent: false, interval: 1000 }, listener)
                this.watched.set(file, listener)
            }
    }
    private async publish(report: VerificationReport) {
        this.staleReports.delete(report.reportId)
        if (!(await this.current(report))) throw new CapabilityError('SNAPSHOT_CHANGED', 'The report is historical; re-run analysis.', true)
        this.watch(report)
        this.reportChanged.fire(vscode.Uri.from({ scheme: 'scad-cad-report', path: `/${report.reportId}` }))
        if (vscode.workspace.getConfiguration('scad-ai-ide.verification').get<boolean>('publishProblems', true)) await this.problems.reportVerification(report, () => this.current(report))
    }
    async analyze(input: AnalyzeInput, signal?: AbortSignal) {
        this.assertAvailable()
        const controller = new AbortController()
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        this.requestControllers.add(controller)
        try {
            await this.runtime.whenReady()
            const initial = await this.capture(input.uri, this.verification.knownDependencies(input.uri), input.projectRoot)
            this.assertAvailable()
            await cadExecution.probe({ command: initial.command, path: initial.path, env: initial.env, parameters: initial.parameters, format: 'csg', signal: combined, timeoutMs: this.timeout() })
            const report = await this.verification.analyze({ ...input, uri: initial.snapshot.document.uri, projectRoot: initial.snapshot.project.rootUri }, combined)
            combined.throwIfAborted()
            await this.publish(report)
            return report
        } finally {
            this.requestControllers.delete(controller)
        }
    }
    async issueDetails(reportId: string, issueId: string, includeEvidence = false, cursor = 0, limit = 100) {
        const entry = this.verification.reports.get(reportId)
        if (!entry && this.geometry) return this.geometry.issueDetails(reportId, issueId, includeEvidence, cursor, limit)
        if (!entry) throw new CapabilityError('REPORT_NOT_FOUND', 'Report expired or was evicted. Explicitly analyze the current source again.', true)
        const issue = entry.report.issues.find((i) => i.id === issueId)
        if (!issue) throw new CapabilityError('ISSUE_NOT_FOUND', 'Issue does not belong to this report.')
        return { reportId, snapshotId: entry.report.snapshot.id, current: await this.current(entry.report), issue, cliExitCode: entry.report.cliExitCode, runtime: entry.report.snapshot.runtime, ...(includeEvidence ? { evidence: { artifactId: entry.report.artifacts[0]?.id, text: entry.log.slice(0, 32768), truncated: entry.report.metrics.truncated || entry.log.length > 32768 } } : {}) }
    }
    async reportText(reportId: string) {
        const entry = this.verification.reports.get(reportId)
        if (!entry && this.geometry) return this.geometry.reportText(reportId)
        if (!entry) throw new CapabilityError('REPORT_NOT_FOUND', 'Report expired or was evicted.')
        return JSON.stringify({ current: await this.current(entry.report), ...entry.report }, null, 2)
    }
    async preparePreview(request: ExecutionRequest) {
        if (!this.availability().enabled) return undefined
        // Existing previews outside a workspace retain their legacy diagnostics adapter.
        try {
            const uri = vscode.Uri.file(request.path).toString()
            const overridesDigest = digest(this.customizer.getOverrides(uri))
            const context: PreviewExecutionContext = { parameters: request.parameters, format: request.format, lazyUnion: request.lazyUnion, sourceTransport: request.source === undefined ? 'file' : 'stdin' }
            const before = await this.capture(uri, this.verification.knownDependencies(uri), undefined, context)
            return async (result: import('../../core/cad/types').CadExecutionResult) => {
                const after = await this.capture(
                    uri,
                    before.snapshot.dependencies.map((d) => vscode.Uri.parse(d.uri).fsPath),
                    undefined,
                    context,
                )
                if (!sameSnapshotEvidence(after.snapshot, before.snapshot) || digest(after.fileStamps) !== digest(before.fileStamps)) return false
                const report = await this.verification.acceptExecution(before, result)
                this.watch(report)
                this.previewContexts.set(report.reportId, { ...context, overridesDigest })
                while (this.previewContexts.size > 128) this.previewContexts.delete(this.previewContexts.keys().next().value!)
                return this.problems.reportVerification(report, () => this.current(report), 'preview-cli')
            }
        } catch {
            return undefined
        }
    }
    private async refreshValidity() {
        await this.problems.revalidate()
    }
    dispose() {
        this.disposed = true
        for (const controller of this.requestControllers) controller.abort()
        this.requestControllers.clear()
        for (const [file, listener] of this.watched) unwatchFile(file, listener)
        this.watched.clear()
        this.reportWatchers.clear()
        this.resolutionPaths.clear()
        this.previewContexts.clear()
        this.runtimeHashes.clear()
        this.parameterDigests.clear()
        this.reportChanged.dispose()
        this.staleReports.clear()
        this.subscriptions.forEach((s) => s.dispose())
        this.verification.dispose()
    }
}
