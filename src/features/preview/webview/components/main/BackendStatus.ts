import { consume } from '@lit/context'
import { css, html, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { CSG_PREVIEW_PHASES, MESH_PREVIEW_PHASES, PREVIEW_PHASES, validPreviewTimings, type PreviewTimings } from '../../../../../core/preview/performance'
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
            overflow: visible;
            color: var(--vscode-descriptionForeground);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }
        tbody {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-auto-flow: column;
            column-gap: 18px;
        }
        tr {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            min-width: 0;
        }
        td:first-child {
            min-width: 0;
        }
        td {
            padding: 1px 5px 1px 0;
            vertical-align: top;
        }
        td:last-child {
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
        }
        tr.total {
            border-top: 1px solid var(--vscode-panel-border);
        }
        pre {
            font-size: 10px;
            white-space: pre-wrap;
            user-select: text;
        }
        .waiting {
            opacity: 0.6;
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

    @state()
    private columns = 1
    private resizeObserver = new ResizeObserver(([entry]) => {
        this.columns = entry.contentRect.width >= 740 ? 3 : entry.contentRect.width >= 440 ? 2 : 1
    })
    connectedCallback() {
        super.connectedCallback()
        this.resizeObserver.observe(this)
    }
    disconnectedCallback() {
        this.resizeObserver.disconnect()
        super.disconnectedCallback()
    }

    render() {
        const backend = this.model?.backend
        if (!backend) return null
        const label = backend.kind === 'unavailable' ? 'Preview unavailable' : backend.kind === 'csg' ? (backend.frameReady ? 'Boolean preview' : 'Preparing Boolean preview') : backend.kind === 'mesh' ? (backend.source === 'mesh-file' ? 'Mesh file preview' : 'CLI mesh render') : 'Checking preview backend…'
        const timings: PreviewTimings = validPreviewTimings(backend.timings ?? {})
        if (backend.firstFrameMs !== undefined) timings.firstFrameMs = backend.firstFrameMs
        const total = backend.frameReady ? timings.totalPreviewMs : undefined
        const totalLabel = total !== undefined ? `${total.toFixed(2)} ms` : !backend.frameReady && backend.kind !== 'unavailable' ? 'measuring…' : '—'
        const phases = backend.kind === 'csg' ? CSG_PREVIEW_PHASES : MESH_PREVIEW_PHASES.filter((key) => backend.source !== 'mesh-file' || !['sourceMs', 'runtimeSelectionMs', 'meshExportMs', 'dependenciesMs', 'cleanupMs', 'watcherMs', 'cliMs'].includes(key))
        return html`<div class="status">
            <div class="headline">
                <strong>${label}</strong>
                <span class="total-time" title="Task start to first-frame acknowledgement. Excludes queueing and debounce before the task starts. An unavailable total is shown as —.">· Total: ${totalLabel}</span>
                ${backend.graphics ? html`<span>· ${backend.graphics === 'webgpu' ? 'WebGPU' : 'WebGL 2'}</span>` : ''}
            </div>
            <details ?open=${backend.kind === 'csg'} @toggle=${(event: Event) => this.toggleAttribute('expanded', (event.currentTarget as HTMLDetailsElement).open)}>
                <summary>Performance details${backend.cacheHit ? ' · cached' : ''}</summary>
                ${backend.reason ? html`<small>${backend.reason}</small>` : ''}
                <table aria-label="Preview pipeline timings">
                    <tbody style=${`grid-template-columns: repeat(${this.columns}, minmax(0, 1fr)); grid-template-rows: repeat(${Math.ceil(phases.length / this.columns)}, auto)`}>
                        ${phases.map((key, index) => {
                            const phase = PREVIEW_PHASES[key]
                            const value = timings[key as keyof PreviewTimings]
                            return html`<tr class=${`${phase.location === 'total' ? 'total' : ''} ${value === undefined ? 'waiting' : ''}`}>
                                <td>${index + 1}. ${key === 'resourcePreparationMs' && backend.kind !== 'csg' ? 'Mesh / material preparation' : phase.label}</td>
                                <td>${value === undefined ? '—' : phase.location === 'count' ? String(value) : value.toFixed(2) + ' ms'}</td>
                            </tr>`
                        })}
                    </tbody>
                </table>
                <details>
                    <summary>Raw timings (JSON)</summary>
                    <pre>${JSON.stringify({ graphics: backend.graphics, cacheHit: !!backend.cacheHit, timings }, null, 2)}</pre>
                </details>
                <small>CPU submission and completion waits are measured separately. Subtotals overlap; do not add all rows.</small>
                <small>${backend.kind === 'csg' && backend.frameReady ? 'Goldfeather image-based CSG · drag updates enabled' : backend.kind === 'csg' ? 'Waiting for the first frame' : 'Release slider to update'}</small>
            </details>
        </div>`
    }
}
