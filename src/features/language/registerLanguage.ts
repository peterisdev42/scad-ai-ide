import * as path from 'node:path'
import * as vscode from 'vscode'
import { LanguageClient, RevealOutputChannelOn, type ServerOptions } from 'vscode-languageclient/node'

import { resolveLanguageServer } from '../../platform/language/serverExecutable'

const section = 'scad-ai-ide.languageServer'
// Bundle the same prefix list contributed to VS Code, rather than maintaining
// a second list of template keywords that can drift from the shipped snippets.
const snippets = require('../../../snippets/openscad.json') as Record<string, { prefix: string | string[] }>
const snippetPrefixes = new Set(Object.values(snippets).flatMap((snippet) => snippet.prefix))

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
                    middleware: {
                        provideCompletionItem: async (document, position, completionContext, token, next) => {
                            const result = await next(document, position, completionContext, token)
                            const editor = vscode.workspace.getConfiguration('editor', { uri: document.uri, languageId: document.languageId })
                            if (!result || editor.get('snippetSuggestions') === 'none' || !editor.get('suggest.showSnippets', true)) {
                                return result
                            }
                            // Keep callable/user symbol completions even when their names
                            // match a template. Only duplicated keyword snippets are hidden.
                            const keep = (item: vscode.CompletionItem) => item.kind !== vscode.CompletionItemKind.Keyword || !(item.insertText instanceof vscode.SnippetString) || !snippetPrefixes.has(typeof item.label === 'string' ? item.label : item.label.label)
                            if (Array.isArray(result)) {
                                return result.filter(keep)
                            }
                            result.items = result.items.filter(keep)
                            return result
                        },
                    },
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
