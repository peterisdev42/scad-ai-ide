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

    @state() private toolStatus = ''
    @state() private previewIssue = ''
    @state() private preparing = false
    public stage?: Stage
    private recovering = false
    private forceWebGL = false
    private loadedModel?: Pick<ModelContext, 'format' | 'base64Data' | 'modelVersion'>
    private resizeObserver: ResizeObserver | null = null
    private themeObserver: MutationObserver | null = null
    private theme: Theme = readPreviewTheme(getComputedStyle(document.body))

    firstUpdated() {
        this.initStage()
        this.setupResizeObserver()
        this.setupThemeObserver()
    }

    async initStage() {
        const stage = (this.stage = new Stage(this.container, this.theme, { forceWebGL: this.forceWebGL }))
        stage.setToolStatusCallback((status) => {
            this.toolStatus = status
        })
        stage.setErrorCallback((error) => {
            if (this.stage === stage && !this.recovering) {
                this.previewIssue = error
                this.preparing = false
            }
        })
        stage.setDeviceLossCallback((reason) => {
            void this.recoverRenderer(reason)
        })
        try {
            await stage.ready
        } catch (error) {
            this.dispatchEvent(new CustomEvent('preview-error', { detail: String(error), bubbles: true, composed: true }))
            return
        }
        if (!this.isConnected || this.stage !== stage) return

        // Process any state that arrived before initialization
        if (this.viewSettingsContext) {
            this.stage.applySettings(this.viewSettingsContext)
        }

        if (this.activeToolContext) {
            stage.setActiveTool(this.activeToolContext.activeTool)
            stage.setToolVariant(this.activeToolContext.variant)
        }
        this.loadModel()
        this.dispatchEvent(new CustomEvent('stage-ready', { bubbles: true, composed: true }))
        return stage
    }

    private async recoverRenderer(reason: string) {
        if (this.recovering || !this.stage) return
        if (this.forceWebGL) {
            this.previewIssue = `Graphics recovery failed: ${reason}`
            return
        }
        this.recovering = true
        const previous = this.stage,
            views = previous.captureCameraViews(),
            properties = previous.serializeProperties()
        this.dispatchEvent(new CustomEvent('renderer-restarting', { detail: { properties }, bubbles: true, composed: true }))
        this.previewIssue = 'WebGPU device lost. Restoring the view with WebGL 2…'
        previous.dispose()
        this.stage = undefined
        this.loadedModel = undefined
        this.container.replaceChildren()
        this.forceWebGL = true
        try {
            const replacement = await this.initStage()
            if (!replacement) throw new Error('Renderer initialization failed')
            replacement.restoreCameraViews(views)
            this.previewIssue = ''
        } catch (error) {
            this.previewIssue = `Graphics recovery failed: ${String(error)}`
        } finally {
            this.recovering = false
        }
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
        if (this.loadedModel?.format === model.format && this.loadedModel.base64Data === model.base64Data && this.loadedModel.modelVersion === model.modelVersion) return
        this.previewIssue = ''
        const stage = this.stage
        this.preparing = !!model.base64Data
        void stage
            .loadModelData({
                ...model,
                frameReady: (graphics, elapsed) => {
                    if (this.stage === stage && this.modelContext.modelVersion === model.modelVersion) {
                        this.preparing = false
                        model.frameReady?.(graphics, elapsed)
                    }
                },
            })
            .catch((error) => {
                if (this.stage !== stage || this.modelContext.modelVersion !== model.modelVersion || this.modelContext.base64Data !== model.base64Data || this.recovering) return
                this.previewIssue = error instanceof Error ? error.message : String(error)
                this.preparing = false
            })
        this.loadedModel = { format: model.format, base64Data: model.base64Data, modelVersion: model.modelVersion }
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
                this.modelContext?.isLoading || this.preparing || !this.modelContext?.base64Data
                    ? html`
                          <div id="loading-overlay" class=${this.modelContext?.isLoading || this.preparing ? '' : 'empty'}>
                              ${this.modelContext?.isLoading || this.preparing ? html`<div class="spinner"></div>` : ''}
                              <div>${this.preparing ? (this.modelContext?.format === 'csg' ? 'Preparing CSG shaders and first complete frame…' : 'Preparing mesh and first frame…') : (this.modelContext?.loadingMessage ?? 'Rendering SCAD...')}</div>
                          </div>
                      `
                    : ''
            }
            ${this.toolStatus || this.previewIssue || this.modelContext?.previewError ? html`<div id="tool-status" role="status" style="position:absolute;top:64px;left:16px;z-index:20;max-width:80%;padding:8px;background:var(--vscode-editor-background);color:var(--vscode-foreground)">${this.modelContext?.previewError || this.previewIssue || this.toolStatus}</div>` : ''}
            <div id="canvas-container"></div>
        `
    }
}
