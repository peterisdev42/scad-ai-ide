import MarkdownIt from 'markdown-it'
import type { PreviewModel } from '../preview/shared/types/PreviewModel'

export interface OwnedBlockState {
    model?: PreviewModel
    message?: string
    disabled?: boolean
}
/** Render a stable block tree so host updates can retain live viewport elements. */
export function renderOwnedMarkdown(source: string, block: (id: string, source: string) => OwnedBlockState, highlight: (source: string) => string, imageUri?: (source: string) => string): string {
    const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true, highlight: (source, language) => (/^(scad|openscad)$/i.test(language) ? highlight(source) : md.utils.escapeHtml(source)) })
    const fence = md.renderer.rules.fence!,
        image = md.renderer.rules.image!
    let index = 0
    md.renderer.rules.fence = (tokens, i, options, env, self) => {
        const token = tokens[i]
        if (!/^(scad|openscad)$/i.test(token.info.trim().split(/\s+/)[0]) || !token.content.trim()) return fence(tokens, i, options, env, self)
        const id = `scad-owned-${index++}`,
            state = block(id, token.content),
            escape = md.utils.escapeHtml,
            model = state.model ? ` data-scad-model="${escape(JSON.stringify(state.model))}"` : ''
        return `<section class="scad-markdown-block" data-scad-block="${id}"><div class="scad-markdown-tabs" role="tablist" aria-label="OpenSCAD"><button type="button" id="${id}-preview-tab" role="tab" data-scad-tab="preview" aria-selected="true" aria-controls="${id}-preview" tabindex="0">Preview</button><button type="button" id="${id}-source-tab" role="tab" data-scad-tab="source" aria-selected="false" aria-controls="${id}-source" tabindex="-1">Source</button></div><div id="${id}-preview" class="scad-markdown-panel scad-markdown-preview" role="tabpanel" data-scad-panel="preview" aria-labelledby="${id}-preview-tab"><div data-owned-model="true" class="scad-markdown-viewer"${state.disabled ? ' data-owned-disabled="true"' : ''}${model} aria-label="Interactive OpenSCAD preview"></div><p class="scad-markdown-status" role="status"${state.message ? '' : ' hidden'}>${escape(state.message ?? '')}</p></div><div id="${id}-source" class="scad-markdown-panel scad-markdown-source" role="tabpanel" data-scad-panel="source" aria-labelledby="${id}-source-tab" hidden><pre><code class="language-openscad">${highlight(token.content)}</code></pre></div></section>`
    }
    if (imageUri)
        md.renderer.rules.image = (tokens, i, options, env, self) => {
            const token = tokens[i],
                src = token.attrGet('src')
            if (src) token.attrSet('src', imageUri(src))
            return image(tokens, i, options, env, self)
        }
    return md.render(source)
}
