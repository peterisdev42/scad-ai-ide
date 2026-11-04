import { stat } from 'node:fs/promises'
import { libraryEnvironment } from '../../platform/libraries/LibraryEnvironment'
import { notifications } from '../../platform/notifications'
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
    const clients = new Map<string, LanguageClient>()
    let pending: Promise<void> = Promise.resolve()
    let disposed = false
    let requested = false

    const restart = () => {
        pending = pending
            .then(async () => {
                for (const previous of clients.values()) await previous.dispose()
                clients.clear()
                const configuration = vscode.workspace.getConfiguration(section)
                if (disposed || !requested || !vscode.workspace.isTrusted || !configuration.get('enabled', true)) {
                    return
                }
                const configuredPath = configuration.get<string>('path', '').trim()
                const bundled = vscode.Uri.joinPath(context.extensionUri, 'server', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp').fsPath
                const command = await resolveLanguageServer(bundled, configuredPath)
                const projects = new Map<string, vscode.TextDocument[]>()
                for (const document of vscode.workspace.textDocuments) {
                    if (document.languageId !== 'openscad' || document.uri.scheme !== 'file') continue
                    const root = (await libraryEnvironment.resolveProjectRoot(document.uri.fsPath)) ?? path.dirname(document.uri.fsPath)
                    try {
                        if (!(await stat(root)).isDirectory()) continue
                    } catch {
                        continue
                    }
                    projects.set(root, [...(projects.get(root) ?? []), document])
                }
                for (const [root, documents] of projects) {
                    const configuration = vscode.workspace.getConfiguration(section, vscode.Uri.file(root))
                    const searchPaths = [...(await libraryEnvironment.getSearchPaths(path.join(root, '__lsp__.scad'))), ...configuration.get<string[]>('searchPaths', [])]
                    output.appendLine(`Starting ${command} --stdio for ${root}`)
                    const serverOptions: ServerOptions = { command, args: ['--stdio'], options: { shell: false, cwd: root, env: await libraryEnvironment.getEnvironment(path.join(root, '__lsp__.scad')) } }
                    const next = new LanguageClient(`scad-ai-ide.openscad.${clients.size}`, 'OpenSCAD Language Server', serverOptions, {
                        // The server resolves paths from file URIs; untitled documents are not supported upstream.
                        // Exact open-document selectors prevent overlapping parent/nested project sessions.
                        documentSelector: documents.map((document) => ({
                            scheme: 'file',
                            language: 'openscad',
                            pattern: document.uri.fsPath
                                .split(path.sep)
                                .join('/')
                                .replace(/[\[\]*?{}]/g, (c) => `[${c}]`),
                        })),
                        workspaceFolder: { uri: vscode.Uri.file(root), name: path.basename(root), index: 0 },
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
                    clients.set(root, next)
                    let started = false
                    try {
                        await next.start()
                        started = true
                        await next.sendNotification('workspace/didChangeConfiguration', {
                            settings: {
                                openscad: {
                                    search_paths: searchPaths.join(path.delimiter),
                                    default_param: configuration.get('defaultParameters', true),
                                    indent: configuration.get('indent', '    '),
                                    query_file: configuration.get<string>('queryFile', '') || null,
                                },
                            },
                        })
                        notifications.languageAvailable()
                    } catch (error) {
                        clients.delete(root)
                        // LanguageClient 9 cannot dispose a client in startFailed state.
                        // Avoid calling stop() on a client that never reached the running state.
                        if (started) {
                            await next.dispose().catch((disposeError: unknown) => output.appendLine(String(disposeError)))
                        }
                        output.appendLine(String(error))
                        void notifications.languageUnavailable()
                    }
                }
            })
            .catch((error: unknown) => {
                output.appendLine(String(error))
                if (!disposed) {
                    void notifications.languageUnavailable()
                }
            })
        return pending
    }

    const open = (document: vscode.TextDocument) => {
        if (document.languageId === 'openscad' && document.uri.scheme === 'file') {
            requested = true
            void restart()
        }
    }

    const stop = async () => {
        disposed = true
        await pending
        for (const client of clients.values()) await client.dispose()
        clients.clear()
    }
    context.subscriptions.push(
        output,
        libraryEnvironment.onDidChange(restart),
        vscode.workspace.onDidChangeWorkspaceFolders(restart),
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
    if (vscode.workspace.textDocuments.some((document) => document.languageId === 'openscad' && document.uri.scheme === 'file')) {
        requested = true
        void restart()
    }
    return { restart, stop, ready: () => pending, isRunning: () => [...clients.values()].some((client) => client.isRunning()) }
}
