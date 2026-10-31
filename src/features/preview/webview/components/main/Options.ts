import { consume } from '@lit/context'
import { css, html, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { CameraMode, BuildPlateOrigin, Environment, RenderMode, ViewOptions, ViewOptionsContext, viewOptionsContext } from '../../contexts/ViewOptionsContext'
import type { IconButton } from '../atoms/IconButton'
import { modelContext, type ModelContext } from '../../contexts/ModelContext'
import '../atoms/Icon'
import '../atoms/IconButton'

declare global {
    interface HTMLElementTagNameMap {
        'scad-options': Options
    }
}

@customElement('scad-options')
export class Options extends LitElement {
    static styles = css`
        :host {
            position: absolute;
            top: 16px;
            right: 16px;
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            max-width: calc(100% - 100px);
            justify-content: flex-end;
            align-items: flex-start;
            gap: 8px;
            z-index: 10;
        }

        .group {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 4px;
            padding: 4px;
            border-radius: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
        }
    `

    @consume({ context: viewOptionsContext, subscribe: true })
    @state()
    private viewSettings!: ViewOptionsContext

    @consume({ context: modelContext, subscribe: true })
    @state()
    private model?: ModelContext

    private set<K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) {
        this.viewSettings.set(key, value)
    }

    private setPreviewMode(mode: 'preview' | 'render', event: Event) {
        ;(event.currentTarget as IconButton).checked = true
        this.model?.setPreviewMode?.(mode)
    }

    private setPlateOrigin(origin: BuildPlateOrigin, event: Event) {
        if (this.viewSettings.get('environment') !== Environment.BuildPlate) return
        ;(event.currentTarget as IconButton).checked = true
        this.set('buildPlateOrigin', origin)
    }

    render() {
        if (!this.viewSettings) return null

        const { get } = this.viewSettings
        const plateEnabled = get('environment') === Environment.BuildPlate

        return html`
            <div class="group">
                <scad-icon-button label="Reset view (fit model, Top)" @change=${() => this.dispatchEvent(new CustomEvent('reset-view', { bubbles: true, composed: true }))}>
                    <scad-icon name="view-reset"></scad-icon>
                </scad-icon-button>
            </div>

            <div class="group">
                <scad-icon-button label="Perspective" toggleable .checked=${get('camera') === CameraMode.Perspective} @change=${() => this.set('camera', CameraMode.Perspective)}>
                    <scad-icon name="camera-perspective"></scad-icon>
                </scad-icon-button>
                <scad-icon-button label="Orthographic" toggleable .checked=${get('camera') === CameraMode.Orthographic} @change=${() => this.set('camera', CameraMode.Orthographic)}>
                    <scad-icon name="camera-orthographic"></scad-icon>
                </scad-icon-button>
            </div>

            ${
                this.model?.setPreviewMode
                    ? html`<div class="group">
                          <scad-icon-button label="CSG preview" .href=${this.model.modeLinks?.preview} toggleable .checked=${this.model.previewMode === 'preview'} @change=${(event: Event) => this.setPreviewMode('preview', event)}>
                              <scad-icon name="render-wireframe"></scad-icon>
                          </scad-icon-button>
                          <scad-icon-button label="Full mesh render" .href=${this.model.modeLinks?.render} toggleable .checked=${this.model.previewMode === 'render'} @change=${(event: Event) => this.setPreviewMode('render', event)}>
                              <scad-icon name="render-solid"></scad-icon>
                          </scad-icon-button>
                      </div>`
                    : null
            }

            <div class="group">
                <scad-icon-button label="Solid" toggleable .checked=${get('renderMode') === RenderMode.Solid} @change=${() => this.set('renderMode', RenderMode.Solid)}><scad-icon name="render-solid"></scad-icon></scad-icon-button>
                <scad-icon-button label="X-Ray" toggleable .checked=${get('renderMode') === RenderMode.XRay} @change=${() => this.set('renderMode', RenderMode.XRay)}><scad-icon name="render-xray"></scad-icon></scad-icon-button>
                <scad-icon-button label="Wireframe" toggleable .checked=${get('renderMode') === RenderMode.Wireframe} @change=${() => this.set('renderMode', RenderMode.Wireframe)}><scad-icon name="render-wireframe"></scad-icon></scad-icon-button>
            </div>

            <div class="group">
                <scad-icon-button label="Toggle Shadows" toggleable .checked=${get('shadows')} @change=${() => this.set('shadows', !get('shadows'))}>
                    <scad-icon name="shadows"></scad-icon>
                </scad-icon-button>
            </div>

            <div class="group">
                <scad-icon-button label="No Environment" toggleable .checked=${get('environment') === Environment.None} @change=${() => this.set('environment', Environment.None)}>
                    <scad-icon name="env-none"></scad-icon>
                </scad-icon-button>
                <scad-icon-button label="Grid" toggleable .checked=${get('environment') === Environment.Grid} @change=${() => this.set('environment', Environment.Grid)}>
                    <scad-icon name="env-grid"></scad-icon>
                </scad-icon-button>
                <scad-icon-button label="Build Plate" toggleable .checked=${get('environment') === Environment.BuildPlate} @change=${() => this.set('environment', Environment.BuildPlate)}>
                    <scad-icon name="env-build-plate"></scad-icon>
                </scad-icon-button>
            </div>

            <div class="group" role="group" aria-label="Build plate origin">
                <scad-icon-button label="Plate origin: center" toggleable .disabled=${!plateEnabled} .checked=${plateEnabled && get('buildPlateOrigin') === BuildPlateOrigin.Center} @change=${(event: Event) => this.setPlateOrigin(BuildPlateOrigin.Center, event)}>
                    <scad-icon name="plate-origin-center"></scad-icon>
                </scad-icon-button>
                <scad-icon-button label="Plate origin: lower-left" toggleable .disabled=${!plateEnabled} .checked=${plateEnabled && get('buildPlateOrigin') === BuildPlateOrigin.LowerLeft} @change=${(event: Event) => this.setPlateOrigin(BuildPlateOrigin.LowerLeft, event)}>
                    <scad-icon name="plate-origin-corner"></scad-icon>
                </scad-icon-button>
            </div>
        `
    }
}
