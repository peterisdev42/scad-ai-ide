import { consume } from '@lit/context'
import { css, html, LitElement, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { activeToolContext, ActiveToolContext } from '../../contexts/ActiveToolContext'
import { modelContext, ModelContext } from '../../contexts/ModelContext'
import { viewOptionsContext, ViewOptionsContext } from '../../contexts/ViewOptionsContext'
import { Stage } from '../../preview/Stage'
import { readPreviewTheme, Theme } from '../../preview/Theme'
import './BackendStatus'

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

        /* One status surface for loading, notices, errors and backend details.
         * No independent position/z-index rules for individual messages. */
        #preview-status {
            position: absolute;
            left: 16px;
            bottom: 16px;
            z-index: 20;
            box-sizing: border-box;
            width: max-content;
            max-width: min(480px, calc(100% - 32px));
            max-height: min(45%, 360px);
            overflow: auto;
            padding: 9px 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            color: var(--vscode-foreground);
            background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            box-shadow: 0 4px 16px var(--vscode-widget-shadow, transparent);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size, 12px);
            line-height: 1.5;
            overflow-wrap: anywhere;
        }
        #preview-status .primary {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        #preview-status .primary.error {
            color: var(--vscode-errorForeground, var(--vscode-foreground));
        }
        #preview-status .backend {
            min-width: 0;
        }
        #preview-status .primary + .backend {
            border-top: 1px solid var(--vscode-panel-border);
            margin-top: 6px;
            padding-top: 6px;
        }
        /* No model loaded: centered placeholder, never a second bottom-left notice. */
        #loading-overlay.empty {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9;
            width: max-content;
            max-width: calc(100% - 2rem);
            box-sizing: border-box;
            padding: 1.25rem 1.75rem;
            color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
            background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.75rem;
            box-shadow: 0 8px 24px var(--vscode-widget-shadow, transparent);
            font-size: max(18px, calc(var(--vscode-font-size, 13px) * 1.4));
            font-weight: 500;
            line-height: 1.5;
            text-align: center;
            pointer-events: none;
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
        const loading = !!(this.modelContext?.isLoading || this.preparing)
        const error = this.modelContext?.previewError || (!this.recovering ? this.previewIssue : '')
        const loadingMessage = this.preparing
            ? this.modelContext?.format === 'csg' ? 'Preparing CSG shaders and first complete frame…' : 'Preparing mesh and first frame…'
            : (this.modelContext?.loadingMessage ?? 'Rendering SCAD...')
        // Severity order: error > renderer recovery > loading > tool notice > backend.
        const primary = error || (this.recovering ? this.previewIssue : '') || (loading ? loadingMessage : this.toolStatus)
        const backend = !!this.modelContext?.backend
        const empty = !this.modelContext?.base64Data && !loading && !error
        return html`
            ${empty ? html`<div id="loading-overlay" class="empty">${this.modelContext?.loadingMessage ?? 'Rendering SCAD...'}</div>` : nothing}
            ${primary || backend ? html`
                <div id="preview-status" role="status" aria-label="Preview status">
                    ${primary ? html`
                        <div id=${error ? 'tool-status' : 'preview-message'} class="primary ${error ? 'error' : ''}">
                            ${loading && !error ? html`<div class="spinner" aria-hidden="true"></div>` : nothing}
                            <span>${primary}</span>
                        </div>
                    ` : nothing}
                    ${backend ? html`<div class="backend"><scad-backend-status></scad-backend-status></div>` : nothing}
                </div>
            ` : nothing}
            <div id="canvas-container"></div>
        `
    }
}
