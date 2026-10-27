import * as vscode from 'vscode'
import { createGitHubRequest } from '../../platform/github/client'
import { describeRequestError } from '../../platform/github/errors'

export interface GitHubState {
    mode: 'checking' | 'anonymous' | 'authenticated'
    busy: boolean
    account?: string
    message?: string
    loginSuggested?: boolean
}

export function registerGitHub(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('SCAD AI IDE GitHub')
    const changed = new vscode.EventEmitter<void>()
    let state: GitHubState = { mode: 'checking', busy: false }
    let generation = 0
    let disposed = false
    const publish = (value: GitHubState) => {
        state = value
        if (!disposed) {
            changed.fire()
        }
    }
    const inspect = async (interactive: boolean) => {
        const current = ++generation
        publish({ ...state, busy: interactive || state.mode === 'checking' })
        try {
            // Empty scopes reuse an authorized account without requesting repository/write permissions.
            const session = await vscode.authentication.getSession('github', [], interactive ? { createIfNone: true } : { silent: true })
            if (current === generation) {
                publish(session?.accessToken ? { mode: 'authenticated', account: session.account?.label, busy: false } : { mode: 'anonymous', busy: false, loginSuggested: state.loginSuggested })
            }
            return session
        } catch (error) {
            const message = `VS Code GitHub authentication unavailable; continuing anonymously.\n${describeRequestError(error)}`
            if (current === generation) {
                publish({ mode: 'anonymous', message, busy: false, loginSuggested: state.loginSuggested })
            }
            if (!disposed) {
                output.appendLine(message)
            }
            throw error
        }
    }
    const refresh = async () => {
        try {
            await inspect(false)
        } catch {
            // The safe state and diagnostics retain the actual provider error.
        }
    }
    const request = createGitHubRequest(
        async () => {
            try {
                return (await inspect(false))?.accessToken
            } catch {
                return undefined
            }
        },
        (url, options) => fetch(url, options),
        undefined,
        () => {
            // A late anonymous failure must not undo a newer successful sign-in.
            if (state.mode !== 'authenticated' && !state.loginSuggested) {
                publish({ ...state, loginSuggested: true })
            }
        },
    )
    context.subscriptions.push(
        output,
        changed,
        vscode.authentication.onDidChangeSessions((event) => {
            if (event.provider.id === 'github') {
                void refresh()
            }
        }),
        {
            dispose: () => {
                disposed = true
                generation++
            },
        },
    )
    return {
        request,
        refresh,
        getState: (): GitHubState => ({ ...state }),
        onDidChange: changed.event,
        connect: async () => {
            await inspect(true)
            // Recheck after account-change events that may have fired during authorization.
            await refresh()
        },
    }
}
