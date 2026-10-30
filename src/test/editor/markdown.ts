import * as vscode from 'vscode'
import { access, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { activate } from '../../extension'

/** Driven by scripts/markdown-webview.test.mjs in an isolated Code profile. */
export async function run() {
    const directory = process.env.SCAD_MARKDOWN_TEST_DIR!
    const cli = join(directory, 'openscad')
    await writeFile(
        cli,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "OpenSCAD version 2026.10.TEST"; exit 0; fi
/bin/cat > /dev/null
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
printf 'cube(size=[20,20,20],center=false);' > "$output"
`,
        { mode: 0o755 },
    )
    const config = vscode.workspace.getConfiguration('scad-ai-ide')
    await config.update('runtimeCommand', { executable: cli, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
    await config.update('languageServer.enabled', false, vscode.ConfigurationTarget.Global)
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'scad-ai-ide')!
    const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
    await api.refresh()
    const uri = vscode.Uri.file(join(directory, 'readme.md'))
    await writeFile(uri.fsPath, '# Preview\n\n```openscad\ncube(20);\n```\n\n```scad\ncube(20);\n```\n')
    const document = await vscode.workspace.openTextDocument(uri)
    // Exercise cached results in the very first Webview document as well as refresh.
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
        const html = await vscode.commands.executeCommand<string>('markdown.api.render', document)
        if ((html?.match(/data-scad-model=/g) ?? []).length === 2) break
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    await vscode.window.showTextDocument(document)
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri)
    await writeFile(join(directory, 'ready'), 'ready')
    let refreshed = false
    for (let i = 0; i < 480; i++) {
        try {
            await access(join(directory, 'done'))
            return
        } catch {
            /* Driver still running. */
        }
        if (!refreshed && (await readFile(join(directory, 'refresh'), 'utf8').catch(() => '')) === 'refresh') {
            refreshed = true
            await vscode.commands.executeCommand('markdown.preview.refresh')
            await writeFile(join(directory, 'refreshed'), 'refreshed')
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('Markdown Webview test driver did not finish.')
}
