import * as vscode from 'vscode'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { activate } from '../../extension'
export async function run() {
    const directory = process.env.SCAD_CANVAS_TEST_DIR!,
        executable = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE!
    const configuration = vscode.workspace.getConfiguration('scad-ai-ide')
    const parameterBenchmark = process.env.SCAD_CANVAS_CUSTOMIZER_BENCH === '1'
    await configuration.update('runtimeCommand', { executable, argsPrefix: [] }, vscode.ConfigurationTarget.Global)
    await configuration.update('languageServer.enabled', false, vscode.ConfigurationTarget.Global)
    await configuration.update('preview.renderMode', parameterBenchmark ? 'preview' : 'render', vscode.ConfigurationTarget.Global)
    const extension = vscode.extensions.all.find((extension) => extension.packageJSON.name === 'scad-ai-ide')!
    const api = (await extension.activate()) as Awaited<ReturnType<typeof activate>>
    await api.refresh()
    const uri = vscode.Uri.file(join(directory, 'switch.scad'))
    await writeFile(uri.fsPath, parameterBenchmark ? 'width=30; // [20:1:40]\ndifference(){cube(width,center=true);cylinder(h=50,r=5,center=true,$fn=32);}\n' : 'cube($preview ? 30 : 10,center=true);\n')
    await vscode.commands.executeCommand('vscode.openWith', uri, 'scad-ai-ide.preview.editor')
    await writeFile(join(directory, 'ready'), 'ready')
    let consumed = -1
    for (let i = 0; i < (parameterBenchmark ? 4800 : 480); i++) {
        try {
            await access(join(directory, 'done'))
            return
        } catch {}
        if (parameterBenchmark)
            try {
                const request = JSON.parse(await readFile(join(directory, 'parameter.json'), 'utf8')) as { id: number; value: number }
                if (request.id !== consumed) {
                    const started = Date.now(),
                        continuous = api.customizer.canPreviewContinuously()
                    api.customizer.set('width', request.value, 'input')
                    consumed = request.id
                    await writeFile(join(directory, 'parameter-start.json'), JSON.stringify({ ...request, started, continuous, vscodeVersion: vscode.version }))
                }
            } catch (error) {
                if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
        await new Promise((resolve) => setTimeout(resolve, parameterBenchmark ? 25 : 250))
    }
    throw new Error('Canvas driver did not finish.')
}
