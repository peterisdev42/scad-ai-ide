;(() => {
    // Markdown loads contribution scripts again as content changes. Reuse listeners
    // and selection state, including across the refresh when a CLI render finishes.
    const key = Symbol.for('scad-ai-ide.markdown.tabs.v3.raster')
    if (window[key]) {
        window[key].restore()
        return
    }
    let hostVisible = true
    const selected = new Map()
    const viewers = new Map()
    const visible = new Set()
    const observed = new Set()
    const saved = new Map()
    const engineKey = Symbol.for('scad-ai-ide.markdown.viewer.v3.raster')
    const destroy = (block) => {
        const entry = viewers.get(block)
        if (!entry) return
        clearTimeout(entry.timer)
        saved.set(block.dataset.scadBlock, entry.control.dispose())
        if (saved.size > 128) saved.delete(saved.keys().next().value)
        viewers.delete(block)
    }
    const updateViewers = () => {
        const candidates = [...visible].filter((block) => hostVisible && block.isConnected && !document.hidden && !block.querySelector('[data-scad-panel="preview"]').hidden)
        candidates.sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top))
        const active = new Set(candidates.slice(0, 2))
        for (const [block, entry] of viewers) {
            if (!block.isConnected) {
                destroy(block)
                continue
            }
            const payload = block.querySelector('[data-scad-model]')?.dataset.scadModel
            if (!entry.control.isConnected() || !payload) {
                destroy(block)
                continue
            }
            if (payload !== entry.payload) {
                if (!entry.control.updateModel) {
                    destroy(block)
                    continue
                }
                entry.control.updateModel(JSON.parse(payload))
                entry.payload = payload
            }
            const running = active.has(block)
            entry.control.setActive(running)
            if (running) {
                clearTimeout(entry.timer)
                entry.timer = undefined
            } else if (!entry.timer) entry.timer = setTimeout(() => destroy(block), 2000)
        }
        const engine = window[engineKey]
        if (!engine) return
        for (const block of active) {
            if (viewers.has(block)) continue
            if (viewers.size >= 2) {
                const retired = [...viewers.keys()].find((item) => !active.has(item))
                if (!retired) continue
                destroy(retired)
            }
            const container = block.querySelector('[data-scad-model]')
            if (!container) continue
            try {
                const control = engine.mount(container, JSON.parse(container.dataset.scadModel), saved.get(block.dataset.scadBlock))
                viewers.set(block, { control, payload: container.dataset.scadModel })
            } catch (error) {
                container.textContent = `OpenSCAD: ${error.message}`
            }
        }
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target)
            else visible.delete(entry.target)
        }
        updateViewers()
    })
    const activate = (block, name, focus = false, refresh = true) => {
        for (const tab of block.querySelectorAll('[data-scad-tab]')) {
            const active = tab.dataset.scadTab === name
            tab.setAttribute('aria-selected', String(active))
            tab.tabIndex = active ? 0 : -1
            if (active && focus) tab.focus({ preventScroll: true })
        }
        for (const panel of block.querySelectorAll('[data-scad-panel]')) {
            panel.hidden = panel.dataset.scadPanel !== name
        }
        if (refresh) updateViewers()
    }
    const restore = () => {
        for (const block of document.querySelectorAll('[data-scad-block]')) {
            activate(block, selected.get(block.dataset.scadBlock) ?? 'preview', false, false)
            if (!observed.has(block)) {
                observer.observe(block)
                observed.add(block)
            }
        }
        for (const block of [...observed])
            if (!block.isConnected) {
                visible.delete(block)
                observer.unobserve(block)
                observed.delete(block)
            }
        updateViewers()
    }
    const choose = (tab) => {
        const block = tab.closest('[data-scad-block]')
        if (!block) return
        selected.set(block.dataset.scadBlock, tab.dataset.scadTab)
        if (selected.size > 128) selected.delete(selected.keys().next().value)
        activate(block, tab.dataset.scadTab, true)
    }
    document.addEventListener('click', (event) => {
        const tab = event.target instanceof Element && event.target.closest('[data-scad-tab]')
        if (!tab) return
        event.preventDefault()
        choose(tab)
    })
    document.addEventListener('keydown', (event) => {
        const tab = event.target instanceof Element && event.target.closest('[data-scad-tab]')
        if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[data-scad-tab]')]
        const index = tabs.indexOf(tab)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        event.preventDefault()
        event.stopPropagation()
        choose(tabs[next])
    })
    // The Markdown host can replace its initial DOM asynchronously, without
    // an updateContent event after contributions have run. Observe those changes
    // as well as later morphs; shadow-root rendering does not reach this observer.
    const contentObserver = new MutationObserver((records) => {
        const containsBlock = (node) => node instanceof Element && (node.matches('[data-scad-block]') || node.querySelector('[data-scad-block]'))
        if (records.some((record) => (record.target instanceof Element && record.target.closest('[data-scad-block]')) || [...record.addedNodes, ...record.removedNodes].some(containsBlock))) restore()
    })
    contentObserver.observe(document, { childList: true, subtree: true })
    window.addEventListener('vscode.markdown.updateContent', restore)
    window.addEventListener('scad-markdown-viewer-ready', updateViewers)
    window.addEventListener('scad-markdown-visibility', (event) => {
        hostVisible = !!event.detail
        updateViewers()
    })
    document.addEventListener('visibilitychange', updateViewers)
    window.addEventListener(
        'pagehide',
        () => {
            for (const block of [...viewers.keys()]) destroy(block)
            observer.disconnect()
            contentObserver.disconnect()
        },
        { once: true },
    )
    window[key] = { restore }
    // The host can finish preparing the Markdown body after contribution scripts run.
    // Do not depend on a later updateContent event to mount the first ready model.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore, { once: true })
    restore()
})()
