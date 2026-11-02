import { consume } from '@lit/context'
import { css, html, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { modelContext, type ModelContext } from '../../contexts/ModelContext'

/** Report the actual evaluator rather than implying the selected mode succeeded. */
@customElement('scad-backend-status')
export class BackendStatus extends LitElement {
    static styles = css`
        :host {
            display: block;
            min-width: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size, 12px);
            color: var(--vscode-foreground);
        }
        .status {
            line-height: 1.45;
            overflow-wrap: anywhere;
        }
        .headline {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0 5px;
        }
        details {
            margin-top: 3px;
            color: var(--vscode-descriptionForeground);
        }
        summary {
            cursor: pointer;
            width: max-content;
            font-size: 11px;
        }
        summary:focus-visible {
            outline: 1px solid var(--vscode-focusBorder);
        }
        small {
            display: block;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
    `
    @consume({ context: modelContext, subscribe: true })
    @state()
    private model?: ModelContext

    render() {
        const backend = this.model?.backend
        if (!backend) return null
        const label = backend.kind === 'csg' ? (backend.frameReady ? 'GPU CSG preview' : 'Preparing GPU CSG preview') : backend.kind === 'mesh' ? 'CLI mesh render' : 'Checking preview backend…'
        return html`<div class="status">
            <div class="headline">
                <strong>${label}</strong>
                ${backend.elapsedMs === undefined ? '' : html`<span>· ${backend.elapsedMs} ms</span>`}
                ${backend.graphics ? html`<span>· ${backend.graphics === 'webgpu' ? 'WebGPU' : 'WebGL 2'}</span>` : ''}
            </div>
            <details>
                <summary>Performance details</summary>
                ${backend.reason ? html`<small>${backend.reason}</small>` : ''}
                ${backend.firstFrameMs === undefined ? '' : html`<small>Viewport first frame: ${backend.firstFrameMs} ms</small>`}
                ${backend.timings ? html`<small>CLI ${Math.round(backend.timings.cliMs ?? 0)} · local ${Math.round(backend.timings.geometryMs ?? 0)} · normalize ${Math.round(backend.timings.normalizationMs ?? 0)} · upload ${Math.round(backend.timings.uploadMs ?? 0)} · shader ${Math.round(backend.timings.shaderMs ?? 0)} ms${backend.cacheHit ? ' · cached' : ''}</small>` : ''}
                ${backend.timings?.topologyMs !== undefined ? html`<small>Exact topology: ${Math.round(backend.timings.topologyMs)} ms</small>` : ''}
                ${backend.timings?.topologyRequestMs !== undefined ? html`<small>Topology request: ${Math.round(backend.timings.topologyRequestMs)} ms</small>` : ''}
                <small>${backend.kind === 'csg' && backend.frameReady ? 'Image-space CSG · drag updates enabled' : backend.kind === 'csg' ? 'Waiting for the first frame' : 'Release slider to update'}</small>
            </details>
        </div>`
    }
}
