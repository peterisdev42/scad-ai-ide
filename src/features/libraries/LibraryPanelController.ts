import { LibraryService } from './LibraryService'

/** Compatibility adapter for the existing Webview protocol. */
export class LibraryPanelController extends LibraryService {
    private activeTab = 'registry'
    refreshActiveTab(): Promise<void> | void {
        if (this.activeTab === 'registry') return this.loadRegistry()
        this.changed.fire()
    }
    async handle(raw: unknown) {
        // Service failures remain visible in state; GUI protocol historically resolves.
        try {
            if (raw && typeof raw === 'object' && (raw as { action?: unknown }).action === 'libraries.selectTab') {
                const tab = (raw as { tab?: unknown }).tab
                if (!['registry', 'global', 'project'].includes(String(tab))) throw new Error('Unknown Library Manager tab.')
                this.activeTab = String(tab)
                await this.refreshActiveTab()
            } else await this.execute(raw, { actor: 'gui' })
        } catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    }
}
