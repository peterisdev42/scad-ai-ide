import { Disposable, RelativePattern, Uri, workspace } from 'vscode'
import { basename, dirname } from 'node:path'

/** Use the extension host's file service, including remote workspaces. */
export class FileWatcher {
    private closed = false
    private readonly subscriptions: Disposable[] = []
    constructor({ path, onChange }: { path: string; onChange: (data: { content: string }) => void }) {
        const uri = Uri.file(path)
        const watcher = workspace.createFileSystemWatcher(new RelativePattern(dirname(path), basename(path)))
        const read = async () => {
            try {
                const content = Buffer.from(await workspace.fs.readFile(uri)).toString('utf8')
                if (!this.closed) {
                    onChange({ content })
                }
            } catch {
                /* A file may be absent or removed while reading it. */
            }
        }
        this.subscriptions.push(
            watcher,
            watcher.onDidCreate(read),
            watcher.onDidChange(read),
            watcher.onDidDelete(() => {
                if (!this.closed) {
                    onChange({ content: '{}' })
                }
            }),
        )
        void read()
    }
    close() {
        this.closed = true
        this.subscriptions.forEach((subscription) => subscription.dispose())
    }
}
