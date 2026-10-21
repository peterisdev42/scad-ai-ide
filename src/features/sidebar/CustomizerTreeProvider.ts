import * as vscode from 'vscode'
import { CustomizerService, validateValue } from '../../core/customizer/CustomizerService'
import type { Parameter, ParameterValue } from '../../core/customizer/CustomizerParser'

export class CustomizerTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>()
    readonly onDidChangeTreeData = this.changed.event
    private readonly subscriptions: vscode.Disposable[]

    constructor(readonly service: CustomizerService) {
        this.subscriptions = [
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.load(editor.document)
                }
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() === service.target) {
                    this.load(event.document)
                }
            }),
            vscode.workspace.onDidCloseTextDocument((document) => {
                if (document.uri.toString() === service.target) {
                    this.loadTarget()
                }
            }),
        ]
        this.loadTarget()
    }

    private loadTarget(): void {
        const editor = vscode.window.activeTextEditor
        if (editor && !editor.document.isClosed && (editor.document.languageId === 'openscad' || editor.document.uri.path.toLowerCase().endsWith('.scad'))) {
            this.load(editor.document)
        } else if (this.service.target && !vscode.workspace.textDocuments.some((document) => document.uri.toString() === this.service.target && !document.isClosed)) {
            this.service.clear()
            this.changed.fire()
        }
    }

    private load(document: vscode.TextDocument): void {
        if (document.languageId !== 'openscad' && !document.uri.path.toLowerCase().endsWith('.scad')) {
            return
        }
        this.service.load(document.uri.toString(), document.getText())
        this.changed.fire()
    }

    getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
        return item
    }

    getChildren(parent?: vscode.TreeItem): vscode.TreeItem[] {
        if (!this.service.target) {
            return []
        }
        if (!parent) {
            const items: vscode.TreeItem[] = []
            const groups = new Set<string>()
            for (const parameter of this.service.parameters) {
                if (!parameter.group) {
                    items.push(this.parameterItem(parameter))
                } else if (!groups.has(parameter.group)) {
                    groups.add(parameter.group)
                    const item = new vscode.TreeItem(parameter.group, vscode.TreeItemCollapsibleState.Expanded)
                    item.id = parameter.group
                    items.push(item)
                }
            }
            return items
        }
        return this.service.parameters.filter((parameter) => parameter.group === parent.id).map((parameter) => this.parameterItem(parameter))
    }

    private parameterItem(parameter: Parameter): vscode.TreeItem {
        const item = new vscode.TreeItem(parameter.name)
        item.description = String(this.service.value(parameter)).replace(/[\r\n]/g, ' ')
        item.tooltip = parameter.description || `Default ${String(parameter.defaultValue)}`
        item.command = { command: 'scad-ai.customizer.edit', title: 'Edit Parameter', arguments: [this.service.target, parameter.name] }
        return item
    }

    async edit(target: string, name: string): Promise<void> {
        if (this.service.target !== target) {
            return
        }
        const parameter = this.service.parameters.find((item) => item.name === name)
        if (!parameter) {
            return
        }
        let value: ParameterValue | undefined
        if (parameter.choices) {
            const choice = await vscode.window.showQuickPick(
                parameter.choices.map((choice) => ({ label: choice.label, value: choice.value })),
                { title: parameter.name },
            )
            value = choice?.value
        } else if (typeof parameter.defaultValue === 'boolean') {
            value = !this.service.value(parameter)
        } else {
            const numeric = typeof parameter.defaultValue === 'number'
            const parse = (text: string) => (numeric ? (text.trim() ? Number(text) : NaN) : text)
            const range = parameter.range
            const input = await vscode.window.showInputBox({
                title: parameter.name,
                value: String(this.service.value(parameter)),
                prompt: range ? `Range ${range.min} to ${range.max}${range.step ? ` step ${range.step}` : ''}` : parameter.description,
                validateInput: (text) => validateValue(parameter, parse(text)),
            })
            if (input !== undefined) {
                value = parse(input)
            }
        }
        if (value === undefined || this.service.target !== target) {
            return
        }
        try {
            this.service.set(name, value)
            this.changed.fire()
        } catch (error) {
            void vscode.window.showErrorMessage(String(error))
        }
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose())
        this.changed.dispose()
    }
}
