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
