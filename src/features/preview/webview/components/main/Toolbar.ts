import { consume } from '@lit/context'
import { css, html, LitElement, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { ActiveTool, ActiveToolContext, activeToolContext } from '../../contexts/ActiveToolContext'
import { viewOptionsContext, ViewOptionsContext } from '../../contexts/ViewOptionsContext'
import { readPreviewTheme } from '../../preview/Theme'
import type { IconButton } from '../atoms/IconButton'
import type { IconName } from '../atoms/Icon'
import '../atoms/Icon'
import '../atoms/IconButton'

declare global {
    interface HTMLElementTagNameMap {
        'scad-toolbar': Toolbar
    }
}

interface ToolVariant {
    id: string
    icon: IconName
    label: string
}

interface Tool {
    id: ActiveTool
    icon: IconName
    label: string
    variants?: ToolVariant[]
    defaultVariant?: string
}

const groups: Tool[][] = [
    [{ id: ActiveTool.Select, icon: 'tool-select', label: 'Select' }],
    [
        {
            id: ActiveTool.Measure,
            icon: 'tool-measure',
            label: 'Measure',
            defaultVariant: 'vertex',
            variants: [
                { id: 'vertex', icon: 'snap-vertex', label: 'Vertex' },
                { id: 'edge', icon: 'snap-edge', label: 'Edge' },
                { id: 'face', icon: 'snap-face', label: 'Face' },
            ],
        },
    ],
]

@customElement('scad-toolbar')
export class Toolbar extends LitElement {
    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            position: absolute;
            top: 16px;
            left: 16px;
            gap: 8px;
            align-items: flex-start;
            z-index: 10;
        }

        .group {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 4px;
            border-radius: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
        }

        input[type='color'] {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            pointer-events: none;
        }

        .group.horizontal {
            flex-direction: row;
        }

        .tool {
            position: relative;
        }

        .variants {
            display: none;
            position: absolute;
            padding-left: 12px;
            left: 100%;
            top: -5px;
        }

        .tool:hover .variants {
            display: flex;
        }
    `

    @consume({ context: activeToolContext, subscribe: true })
    @state()
    private activeToolContext!: ActiveToolContext

    @consume({ context: viewOptionsContext, subscribe: true })
    @state()
    private viewSettings!: ViewOptionsContext

    @query('#model-color')
    private colorInput!: HTMLInputElement

    private rememberedVariants = new Map<ActiveTool, string>()

    render() {
        return html`
            ${groups.map(
                (group) => html`
                    <div class="group">
                        ${group.map((tool) => this.renderTool(tool))}
                        ${
                            group.some((tool) => tool.id === ActiveTool.Measure)
                                ? html`<scad-icon-button
                                      label="Clear all measurements"
                                      @change=${() =>
                                          this.dispatchEvent(
                                              new CustomEvent('clear-measurements', {
                                                  bubbles: true,
                                                  composed: true,
                                              }),
                                          )}
                                  >
                                      <scad-icon name="clear-measurements"></scad-icon>
                                  </scad-icon-button>`
                                : nothing
                        }
                    </div>
                `,
            )}
            <div class="group" role="group" aria-label="Model color">
                <scad-icon-button label="Choose model color" @change=${() => this.colorInput.click()}>
                    <scad-icon name="model-color"></scad-icon>
                </scad-icon-button>
                <input id="model-color" type="color" tabindex="-1" aria-label="Model color" .value=${this.viewSettings?.get('modelColor') ?? `#${readPreviewTheme(getComputedStyle(document.body)).additive.getHexString()}`} @input=${(event: Event) => this.viewSettings.set('modelColor', (event.target as HTMLInputElement).value)} />
                ${this.viewSettings?.get('modelColor') ? html`<scad-icon-button label="Restore default model color" @change=${() => this.viewSettings.set('modelColor', null)}><scad-icon name="color-reset"></scad-icon></scad-icon-button>` : nothing}
            </div>
        `
    }

    private renderTool(tool: Tool) {
        const activeVariant = this.getActiveVariant(tool)

        return html`
            <div class="tool">
                <scad-icon-button
                    label=${tool.label}
                    toggleable
                    .checked=${this.activeToolContext?.activeTool === tool.id}
                    @change=${(event: Event) => {
                        const next = this.activeToolContext.activeTool === tool.id ? ActiveTool.Select : tool.id
                        this.activeToolContext.setActiveTool(next, next === ActiveTool.Select ? null : activeVariant)
                        ;(event.currentTarget as IconButton).checked = next === tool.id
                        this.requestUpdate()
                    }}
                >
                    <scad-icon name=${tool.icon}></scad-icon>
                </scad-icon-button>
                ${
                    tool.variants
                        ? html`
                              <div class="variants">
                                  <div class="group horizontal">
                                      ${tool.variants.map(
                                          (variant) => html`
                                              <scad-icon-button
                                                  label=${variant.label}
                                                  toggleable
                                                  .checked=${this.activeToolContext?.activeTool === tool.id && activeVariant === variant.id}
                                                  @change=${(event: Event) => {
                                                      ;(event.currentTarget as IconButton).checked = true
                                                      this.rememberedVariants.set(tool.id, variant.id)
                                                      if (this.activeToolContext.activeTool === tool.id) {
                                                          this.activeToolContext.setVariant(variant.id)
                                                      } else {
                                                          this.activeToolContext.setActiveTool(tool.id, variant.id)
                                                      }
                                                      this.requestUpdate()
                                                  }}
                                              >
                                                  <scad-icon name=${variant.icon}></scad-icon>
                                              </scad-icon-button>
                                          `,
                                      )}
                                  </div>
                              </div>
                          `
                        : nothing
                }
            </div>
        `
    }

    private getActiveVariant(tool: Tool): string | undefined {
        if (!tool.variants) return undefined
        return this.rememberedVariants.get(tool.id) ?? tool.defaultVariant
    }
}
