import * as vscode from 'vscode'

export const quickAccess = [
    { id: 'ai', title: 'AI', command: 'scad-ai.ai.open' },
    { id: 'bricks', title: 'Bricks', command: 'scad-ai.bricks.open' },
    { id: 'libraries', title: 'Libraries', command: 'scad-ai.libraries.open' },
    { id: 'runtime', title: 'Runtime', command: 'scad-ai.runtime.open' },
    { id: 'more', title: 'More', command: 'scad-ai.more.open' },
] as const

export class QuickAccessTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
        return item
    }

    getChildren(parent?: vscode.TreeItem): vscode.TreeItem[] {
        return parent
            ? []
            : quickAccess.map((page) => {
                  const item = new vscode.TreeItem(page.title)
                  item.id = page.id
                  item.command = { command: page.command, title: page.title }
                  return item
              })
    }
}
