import { DomScrollableElement } from 'monaco-editor/base/browser/ui/scrollbar/scrollableElement.js'

// This internal API is supplied by the exact monaco-editor version in package.json.
// Keep all access to its DOM-backed scrollbar and smooth-scrolling internals here.
export function attachCustomizerScrollbar(host, viewport, content) {
    const scrollbar = new DomScrollableElement(viewport, {
        className: 'customizer-scrollable',
        horizontal: 2, // ScrollbarVisibility.Hidden; the parameter layout wraps instead.
        vertical: 1, // ScrollbarVisibility.Auto
        useShadows: true,
        consumeMouseWheelIfScrollbarIsNeeded: true,
    })
    const node = scrollbar.getDomNode()
    host.append(node)
    let frame
    let disposed = false
    let settings = {}
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const layout = () => {
        if (frame !== undefined || disposed) return
        frame = requestAnimationFrame(() => {
            frame = undefined
            scrollbar.scanDomNode()
            // Reserve space only when needed, so overlay thumbs do not cover controls.
            const overflowing = viewport.scrollHeight > viewport.clientHeight
            node.classList.toggle('has-vertical-scrollbar', overflowing)
            scrollbar.scanDomNode()
        })
    }
    const updateSettings = (next = settings) => {
        settings = next
        const size = Number.isFinite(next.size) ? Math.max(1, next.size) : 10
        node.style.setProperty('--customizer-scrollbar-size', `${size}px`)
        node.classList.toggle('modern-ui', !!next.modernUI)
        scrollbar.updateOptions({
            verticalScrollbarSize: size,
            mouseWheelScrollSensitivity: next.mouseWheelScrollSensitivity ?? 1,
            fastScrollSensitivity: next.fastScrollSensitivity ?? 5,
        })
        // DomScrollableElement defaults to immediate DOM scrolling. Use the same
        // 125ms smooth scroll duration as VS Code ListView when the user enables it.
        const smooth = !!next.smoothScrolling && !reducedMotion.matches && !document.body.classList.contains('vscode-reduce-motion')
        scrollbar._options.mouseWheelSmoothScroll = smooth
        scrollbar._scrollable.setSmoothScrollDuration(smooth ? 125 : 0)
        layout()
    }
    const onMotionChange = () => updateSettings()
    reducedMotion.addEventListener('change', onMotionChange)
    const resize = new ResizeObserver(layout)
    resize.observe(viewport)
    resize.observe(content)
    const mutations = new MutationObserver(layout)
    mutations.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
    const bodyClasses = new MutationObserver(onMotionChange)
    bodyClasses.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    // Focus, scrollIntoView and keyboard navigation may scroll the DOM independently.
    viewport.addEventListener('scroll', layout, { passive: true })
    updateSettings()

    return {
        updateSettings,
        layout,
        resetPosition: () => scrollbar.setScrollPosition({ scrollTop: 0, scrollLeft: 0 }),
        dispose() {
            disposed = true
            if (frame !== undefined) cancelAnimationFrame(frame)
            resize.disconnect()
            mutations.disconnect()
            bodyClasses.disconnect()
            reducedMotion.removeEventListener('change', onMotionChange)
            viewport.removeEventListener('scroll', layout)
            scrollbar.dispose()
        },
    }
}
