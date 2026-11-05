import { commands, window } from 'vscode'
import { NotificationCenter } from '../core/notifications/NotificationCenter'
import { createNotifications } from '../core/notifications/createNotifications'

const center = new NotificationCenter(
    async (notice) => {
        const actions = notice.actions?.map((action) => action.label) ?? []
        switch (notice.severity) {
            case 'error':
                return window.showErrorMessage(notice.message, ...actions)
            case 'warning':
                return window.showWarningMessage(notice.message, ...actions)
            case 'info':
                return window.showInformationMessage(notice.message, ...actions)
        }
    },
    (error) => console.error('[SCAD AI IDE notification]', error),
)

/** One shared center per extension host; features report through this catalog. */
export const notifications = createNotifications(center, (command, ...args) => commands.executeCommand(command, ...args))

/** Explicit user decisions are never suppressed as duplicate problem reports. */
export async function confirmDeleteParameterSet(name: string): Promise<boolean> {
    return (await window.showWarningMessage(`Delete the "${name}" parameter set?`, { modal: true }, 'Delete')) === 'Delete'
}

export async function confirmLibraryCopy(source: string, sizeBytes: number): Promise<boolean> {
    return (await window.showWarningMessage(`Directory links are unavailable. Copy ${(sizeBytes / 1048576).toFixed(1)} MiB of library files into this project? Copies use additional disk space. Source: ${source}`, { modal: true }, 'Copy Library')) === 'Copy Library'
}

export async function confirmLibraryCleanup(name: string, bytes: number, unavailable: string[]): Promise<boolean> {
    return (await window.showWarningMessage(`Delete global library ${name} (${(bytes / 1048576).toFixed(1)} MiB)? No known project currently references it. Projects outside this IDE's reference index may still use it and will need Restore Dependencies.${unavailable.length ? ` Unavailable projects could not be checked: ${unavailable.join(', ')}.` : ''}`, { modal: true }, 'Delete Cached Version')) === 'Delete Cached Version'
}

export async function confirmLibraryBulkCleanup(count: number, bytes: number, mode: 'all' | 'unused', protectedCount: number): Promise<boolean> {
    const impact = mode === 'all'
        ? 'This also removes versions used by projects. Project manifests and lockfiles are kept; use Restore Dependencies to download their sources again.'
        : `Only versions unreferenced by known projects will be removed. ${protectedCount} referenced or unverifiable versions will be skipped. Projects outside this IDE reference index cannot be checked.`
    return (await window.showWarningMessage(`Delete ${count} global dependency versions (${(bytes / 1048576).toFixed(1)} MiB)? ${impact}`, { modal: true }, mode === 'all' ? 'Delete All Global Dependencies' : 'Delete Unreferenced Dependencies')) === (mode === 'all' ? 'Delete All Global Dependencies' : 'Delete Unreferenced Dependencies')
}
