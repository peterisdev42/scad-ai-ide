import * as path from 'node:path'
import * as vscode from 'vscode'
import { LanguageClient, RevealOutputChannelOn, type ServerOptions } from 'vscode-languageclient/node'

import { resolveLanguageServer } from '../../platform/language/serverExecutable'

const section = 'scad-ai-ide.languageServer'

export function registerLanguage(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('SCAD AI IDE Language Server')
    let client: LanguageClient | undefined
    let pending: Promise<void> = Promise.resolve()
    let disposed = false
    let requested = false

    const restart = () => {
        pending = pending
            .then(async () => {
                if (client) {
                    const previous = client
                    client = undefined
                    await previous.dispose()
                }
                const configuration = vscode.workspace.getConfiguration(section)
                if (disposed || !requested || !vscode.workspace.isTrusted || !configuration.get('enabled', true)) {
                    return
                }
                const configuredPath = configuration.get<string>('path', '').trim()
                const bundled = vscode.Uri.joinPath(context.extensionUri, 'server', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp').fsPath
                const command = await resolveLanguageServer(bundled, configuredPath)
                output.appendLine(`Starting ${command} --stdio`)
                const serverOptions: ServerOptions = { command, args: ['--stdio'], options: { shell: false } }
                const next = new LanguageClient('scad-ai-ide.openscad', 'OpenSCAD Language Server', serverOptions, {
                    // The server resolves paths from file URIs; untitled documents are not supported upstream.
                    documentSelector: [{ scheme: 'file', language: 'openscad' }],
                    outputChannel: output,
                    revealOutputChannelOn: RevealOutputChannelOn.Never,
                    markdown: { isTrusted: false, supportHtml: false },
                })
                client = next
                let started = false
                try {
                    await next.start()
                    started = true
                    await next.sendNotification('workspace/didChangeConfiguration', {
                        settings: {
                            openscad: {
                                search_paths: configuration.get<string[]>('searchPaths', []).join(path.delimiter),
                                default_param: configuration.get('defaultParameters', true),
                                indent: configuration.get('indent', '    '),
                                query_file: configuration.get<string>('queryFile', '') || null,
                            },
                        },
                    })
                } catch (error) {
                    client = undefined
                    // LanguageClient 9 cannot dispose a client in startFailed state.
                    // Avoid calling stop() on a client that never reached the running state.
                    if (started) {
                        await next.dispose().catch((disposeError: unknown) => output.appendLine(String(disposeError)))
                    }
                    throw error
                }
            })
            .catch((error: unknown) => {
                output.appendLine(String(error))
                if (!disposed) {
                    void vscode.window.showWarningMessage('OpenSCAD language server could not start. For development run npm run prepare:lsp in the extension source directory, install openscad-lsp on PATH, or set scad-ai-ide.languageServer.path. See the SCAD AI IDE Language Server output for details.')
                }
            })
        return pending
    }

    const open = (document: vscode.TextDocument) => {
        if (!requested && document.languageId === 'openscad' && document.uri.scheme === 'file') {
            requested = true
            void restart()
        }
    }

    const stop = async () => {
        disposed = true
        await pending
        await client?.dispose()
        client = undefined
    }
    context.subscriptions.push(
        output,
        vscode.commands.registerCommand('scad-ai-ide.restartLanguageServer', () => {
            requested = true
            return restart()
        }),
        vscode.commands.registerCommand('scad-ai-ide.showLanguageServerOutput', () => output.show()),
        vscode.workspace.onDidOpenTextDocument(open),
        vscode.workspace.onDidGrantWorkspaceTrust(restart),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(section)) {
                void restart()
            }
        }),
        {
            dispose: () => {
                void stop()
            },
        },
    )
    vscode.workspace.textDocuments.forEach(open)
    return { restart, stop, ready: () => pending, isRunning: () => client?.isRunning() ?? false }
}
