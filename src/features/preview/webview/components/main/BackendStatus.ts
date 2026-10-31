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
        const label = backend.kind === 'csg' ? (backend.frameReady?'GPU CSG preview':'Preparing GPU CSG preview') : backend.kind === 'mesh' ? 'CLI mesh render' : 'Checking preview backend…'
        return html`<div class="status" role="status">
            <strong>${label}</strong>${backend.elapsedMs === undefined ? '' : html`<span> · ${backend.elapsedMs} ms</span>`}${backend.graphics ? html`<span> · ${backend.graphics === 'webgpu' ? 'WebGPU' : 'WebGL 2'}</span>` : ''} ${backend.reason ? html`<small>${backend.reason}</small>` : ''} ${backend.firstFrameMs === undefined ? '' : html`<small>Viewport first frame: ${backend.firstFrameMs} ms</small>`}
            ${backend.timings?html`<small>CLI ${Math.round(backend.timings.cliMs??0)} · local ${Math.round(backend.timings.geometryMs??0)} · normalize ${Math.round(backend.timings.normalizationMs??0)} · upload ${Math.round(backend.timings.uploadMs??0)} · shader ${Math.round(backend.timings.shaderMs??0)} ms${backend.cacheHit?' · cached':''}</small>`:''}
            <small>${backend.kind === 'csg' && backend.frameReady ? 'Image-space CSG · drag updates enabled' : backend.kind === 'csg' ? 'Waiting for the first frame' : 'Release slider to update'}</small>
        </div>`
    }
}
