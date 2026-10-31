// Built-in Markdown reruns contribution scripts after content updates. Defer the
// component graph until this document has claimed its single bootstrap promise.
const markdownHost = window as unknown as Record<symbol, unknown>
const markdownEngine = Symbol.for('scad-ai-ide.markdown.viewer.v2.blas')
const markdownBootstrap = Symbol.for('scad-ai-ide.markdown.bootstrap.v2.blas')
if (markdownHost[markdownEngine]) window.dispatchEvent(new Event('scad-markdown-viewer-ready'))
else if (!markdownHost[markdownBootstrap]) {
    markdownHost[markdownBootstrap] = import('./markdown').catch((error) => {
        delete markdownHost[markdownBootstrap]
        console.error('OpenSCAD Markdown preview initialization failed:', error)
    })
}
