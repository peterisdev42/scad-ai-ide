import * as vscode from 'vscode'
import { access, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { activate } from '../../extension'

/** Driven by scripts/markdown-webview.test.mjs in an isolated Code profile. */
export async function run() {
    const directory = process.env.SCAD_MARKDOWN_TEST_DIR!
    const owned = process.env.SCAD_MARKDOWN_OWNED === '1'
    const cli = join(directory, 'openscad')
    const vertices = [
            [0, 0, 0],
            [20, 0, 0],
            [20, 20, 0],
            [0, 20, 0],
            [0, 0, 20],
            [20, 0, 20],
            [20, 20, 20],
            [0, 20, 20],
        ],
        faces = [
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [1, 2, 6],
            [1, 6, 5],
            [2, 3, 7],
            [2, 7, 6],
            [3, 0, 4],
            [3, 4, 7],
        ]
    const stl = 'solid part\n' + faces.map((face) => 'facet normal 0 0 0\nouter loop\n' + face.map((id) => 'vertex ' + vertices[id].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid part\n'
    await writeFile(
        cli,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "OpenSCAD version 2026.10.TEST"; exit 0; fi
source=$(/bin/cat)
case "$source" in *BROKEN*) echo "ERROR: Parser error: test" >&2; exit 1;; esac
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
case "$output" in
*.stl) /bin/cat <<'SCAD_TEST_STL' > "$output"
${stl}
SCAD_TEST_STL
;;
*) printf 'cube(size=[20,20,20],center=false);' > "$output";;
esac
`,
        { mode: 0o755 },
    )
    const config = vscode.workspace.getConfiguration('scad-ai-ide')
    await config.update('runtimeCommand', { executable: cli, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
    await config.update('languageServer.enabled', false, vscode.ConfigurationTarget.Global)
    await config.update('markdown.preview.renderMode', 'preview', vscode.ConfigurationTarget.Global)
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
    await vscode.commands.executeCommand(owned ? 'scad-ai-ide.markdown.openPreview' : 'markdown.showPreviewToSide', uri)
    await writeFile(join(directory, 'ready'), 'ready')
    let refreshed = false,
        invalidated = false
    for (let i = 0; i < 480; i++) {
        try {
            await access(join(directory, 'done'))
            return
        } catch {
            /* Driver still running. */
        }
        if (!refreshed && (await readFile(join(directory, 'refresh'), 'utf8').catch(() => '')) === 'refresh') {
            refreshed = true
            if (owned) {
                const edit = new vscode.WorkspaceEdit()
                edit.insert(uri, new vscode.Position(0, 0), 'Updated heading\n\n')
                await vscode.workspace.applyEdit(edit)
            } else await vscode.commands.executeCommand('markdown.preview.refresh')
            await writeFile(join(directory, 'refreshed'), 'refreshed')
        }
        if (owned && !invalidated && (await readFile(join(directory, 'invalid'), 'utf8').catch(() => '')) === 'invalid') {
            invalidated = true
            const edit = new vscode.WorkspaceEdit()
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), document.getText().replace('cube(20);', 'BROKEN;'))
            await vscode.workspace.applyEdit(edit)
            await writeFile(join(directory, 'invalidated'), 'invalidated')
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('Markdown Webview test driver did not finish.')
}
