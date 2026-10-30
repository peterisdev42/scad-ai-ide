import { consume } from '@lit/context'
import { css, html, LitElement } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { activeToolContext, ActiveToolContext } from '../../contexts/ActiveToolContext'
import { modelContext, ModelContext } from '../../contexts/ModelContext'
import { viewOptionsContext, ViewOptionsContext } from '../../contexts/ViewOptionsContext'
import { Stage } from '../../preview/Stage'
import { readPreviewTheme, Theme } from '../../preview/Theme'

declare global {
    interface HTMLElementTagNameMap {
        'scad-preview': Preview
    }
}

@customElement('scad-preview')
export class Preview extends LitElement {
    static styles = css`
        :host {
            display: block;
            width: 100%;
            height: 100%;
            position: relative;
            overflow: hidden;
        }

        #canvas-container {
            width: 100%;
            height: 100%;
            display: block;
        }

        .main-canvas {
            display: block;
            width: 100% !important;
            height: 100% !important;
        }

        #loading-overlay {
            position: absolute;
            bottom: 1rem;
            left: 1rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            z-index: 1000;
            color: var(--vscode-foreground);
            background: rgba(0, 0, 0, 0.15);
            border-radius: 0.25rem;
            padding: 0.75rem 1rem 0.75rem 0.75rem;
            pointer-events: none;
        }

        #loading-overlay.empty {
            top: 50%;
            left: 50%;
            bottom: auto;
            transform: translate(-50%, -50%);
            width: max-content;
            max-width: calc(100% - 2rem);
            box-sizing: border-box;
            padding: 1.25rem 1.75rem;
            color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
            background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 80%, transparent);
            border: 1px solid var(--vscode-contrastBorder, var(--vscode-editorWidget-border, var(--vscode-panel-border, color-mix(in srgb, var(--vscode-foreground) 20%, transparent))));
            border-radius: 0.75rem;
            box-shadow: 0 8px 24px var(--vscode-widget-shadow, transparent);
            -webkit-backdrop-filter: blur(14px) saturate(130%);
            backdrop-filter: blur(14px) saturate(130%);
            font-family: var(--vscode-font-family);
            font-size: max(18px, calc(var(--vscode-font-size, 13px) * 1.4));
            font-weight: 500;
            line-height: 1.5;
            text-align: center;
        }

        .spinner {
            border: 2px solid var(--vscode-editorGhostText-border, rgba(255, 255, 255, 0.1));
            border-top: 2px solid var(--vscode-button-background);
            border-radius: 50%;
            width: 1rem;
            height: 1rem;
            flex-shrink: 0;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }
            100% {
                transform: rotate(360deg);
            }
        }
    `

    @consume({ context: viewOptionsContext, subscribe: true })
    @state()
    viewSettingsContext!: ViewOptionsContext

    @consume({ context: modelContext, subscribe: true })
    @state()
    modelContext!: ModelContext

    @consume({ context: activeToolContext, subscribe: true })
    @state()
    activeToolContext!: ActiveToolContext

    @query('#canvas-container')
    private container!: HTMLElement

    public stage?: Stage
    private loadedModel?: Pick<ModelContext, 'format' | 'base64Data'>
    private resizeObserver: ResizeObserver | null = null
    private themeObserver: MutationObserver | null = null
    private theme: Theme = readPreviewTheme(getComputedStyle(document.body))

    firstUpdated() {
        this.initStage()
        this.setupResizeObserver()
        this.setupThemeObserver()
    }

    initStage() {
        this.stage = new Stage(this.container, this.theme)

        // Process any state that arrived before initialization
        if (this.viewSettingsContext) {
            this.stage.applySettings(this.viewSettingsContext)
        }

        this.loadModel()
        this.dispatchEvent(new CustomEvent('stage-ready', { bubbles: true, composed: true }))
    }

    // Bridging the declarative Lit cycle with the imperative Three.js cycle
    updated(changedProperties: Map<string, unknown>) {
        if (!this.stage) return

        if (changedProperties.has('viewSettingsContext') && this.viewSettingsContext) {
            this.stage.applySettings(this.viewSettingsContext)
        }

        if (changedProperties.has('modelContext')) this.loadModel()

        if (changedProperties.has('activeToolContext') && this.activeToolContext) {
            this.stage.setActiveTool(this.activeToolContext.activeTool)
            this.stage.setToolVariant(this.activeToolContext.variant)
        }
    }

    private loadModel() {
        const model = this.modelContext
        if (!this.stage || !model) return
        if (this.loadedModel?.format === model.format && this.loadedModel.base64Data === model.base64Data) return
        this.stage.loadModelData(model)
        this.loadedModel = { format: model.format, base64Data: model.base64Data }
    }

    disconnectedCallback() {
        super.disconnectedCallback()

        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
        }

        if (this.themeObserver) {
            this.themeObserver.disconnect()
        }

        if (this.stage) {
            this.stage.dispose()
        }
    }

    private setupThemeObserver() {
        this.themeObserver = new MutationObserver(() => {
            this.theme = readPreviewTheme(getComputedStyle(document.body))

            if (this.stage) {
                this.stage.updateTheme(this.theme)
            }
        })

        for (const element of [document.body, document.documentElement]) {
            this.themeObserver.observe(element, {
                attributes: true,
                attributeFilter: ['class', 'style', 'data-vscode-theme', 'data-vscode-theme-kind', 'data-vscode-theme-id'],
            })
        }
    }

    private setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(() => {
            if (this.container && this.stage) {
                this.stage.resize(this.container.clientWidth, this.container.clientHeight)
            }
        })

        this.resizeObserver.observe(this.container)
    }

    render() {
        return html`
            ${
                this.modelContext?.isLoading || !this.modelContext?.base64Data
                    ? html`
                          <div id="loading-overlay" class=${this.modelContext?.isLoading ? '' : 'empty'}>
                              ${this.modelContext?.isLoading ? html`<div class="spinner"></div>` : ''}
                              <div>${this.modelContext?.loadingMessage ?? 'Rendering SCAD...'}</div>
                          </div>
                      `
                    : ''
            }
            <div id="canvas-container"></div>
        `
    }
}
