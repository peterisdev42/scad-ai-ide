import { consume } from '@lit/context'
import { css, html, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { modelContext, type ModelContext } from '../../contexts/ModelContext'

/** Report the actual evaluator rather than implying the selected mode succeeded. */
@customElement('scad-backend-status')
export class BackendStatus extends LitElement {
    static styles = css`
        :host {
            position: absolute;
            left: 16px;
            bottom: 16px;
            z-index: 11;
            max-width: calc(100% - 150px);
            pointer-events: none;
        }
        .status {
            padding: 7px 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size, 12px);
            line-height: 1.5;
            overflow-wrap: anywhere;
        }
        .fallback {
            border-color: var(--vscode-editorWarning-foreground, var(--vscode-panel-border));
        }
        .fallback strong {
            color: var(--vscode-editorWarning-foreground, var(--vscode-foreground));
        }
        small {
            display: block;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        :host([loading]) {
            bottom: 80px;
        }
    `
    @consume({ context: modelContext, subscribe: true })
    @state()
    private model?: ModelContext

    updated() {
        this.toggleAttribute('loading', !!this.model?.isLoading)
    }

    render() {
        const backend = this.model?.backend
        if (!backend) return null
        const label = backend.kind === 'fallback' ? 'CSG → STL fallback' : backend.kind === 'csg' ? 'CSG / Manifold mesh' : backend.kind === 'mesh' ? 'CLI mesh render' : 'Checking preview backend…'
        return html`<div class="status ${backend.kind === 'fallback' ? 'fallback' : ''}" role="status">
            <strong>${label}</strong>${backend.elapsedMs === undefined ? '' : html`<span> · ${backend.elapsedMs} ms</span>`} ${backend.reason ? html`<small>${backend.reason}</small>` : ''}
            <small>${backend.kind === 'csg' ? 'Mesh evaluation · drag updates enabled' : 'Release slider to update'}</small>
        </div>`
    }
}
