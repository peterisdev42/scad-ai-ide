import { NotificationCenter } from './NotificationCenter'
import { RuntimeUnavailableError } from '../runtime/errors'

const detail = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Notification catalog: wording, recovery actions, identity and lifetime live here. */
export function createNotifications(center: NotificationCenter, executeCommand: (command: string, ...args: unknown[]) => unknown) {
    const runtimeUnavailable = () =>
        center.notify({
            id: 'runtime.unavailable',
            severity: 'error',
            policy: 'until-resolved',
            message: 'No OpenSCAD runtime is available.',
            actions: [{ label: 'Install OpenSCAD CLI', run: () => executeCommand('scad-ai.runtime.open', 'available') }],
        })
    const renderFailed = (error: Error, showOutput: () => void, scope?: string) => (error instanceof RuntimeUnavailableError ? runtimeUnavailable() : center.notify({ id: 'preview.renderFailed', scope, severity: 'error', fingerprint: error.message, message: `OpenSCAD render failed: ${error.message.split('\n')[0]}`, actions: [{ label: 'Show Output', run: showOutput }] }))

    return {
        reset: () => center.reset(),
        dispose: () => center.dispose(),
        runtimeUnavailable,
        runtimeAvailable: () => center.resolve('runtime.unavailable'),
        languageUnavailable: () => center.notify({ id: 'language.unavailable', severity: 'warning', policy: 'until-resolved', message: 'OpenSCAD language server could not start. For development run npm run prepare:lsp in the extension source directory, install openscad-lsp on PATH, or set scad-ai-ide.languageServer.path. See the SCAD AI IDE Language Server output for details.', actions: [{ label: 'Show Output', run: () => executeCommand('scad-ai-ide.showLanguageServerOutput') }] }),
        languageAvailable: () => center.resolve('language.unavailable'),
        renderFailed,
        previewError: (error: unknown, scope: string) => (error instanceof RuntimeUnavailableError ? runtimeUnavailable() : center.notify({ id: 'preview.error', scope, severity: 'error', message: `OpenSCAD preview: ${detail(error)}` })),
        customizerError: (error: unknown, scope: string) => center.notify({ id: 'customizer.error', scope, severity: 'error', message: detail(error) }),
        exported: (format: string, path: string) => center.notify({ id: 'preview.exported', scope: path, severity: 'info', message: `Successfully exported ${format} to ${path}` }),
        exportFailed: (error: unknown, format: string, scope: string) => (error instanceof RuntimeUnavailableError ? runtimeUnavailable() : center.notify({ id: 'preview.exportFailed', scope, severity: 'error', message: `Failed to export ${format}: ${detail(error)}` })),
        slicerFailed: (error: unknown, scope: string) => (error instanceof RuntimeUnavailableError ? runtimeUnavailable() : center.notify({ id: 'preview.slicerFailed', scope, severity: 'error', message: `Failed to send to slicer: ${detail(error)}` })),
    }
}
