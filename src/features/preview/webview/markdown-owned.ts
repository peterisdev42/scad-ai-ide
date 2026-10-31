import './markdown'
import type { CsgClipPlane, CsgGeometry } from '../../../core/csg/types'

const api = acquireVsCodeApi()
interface Pending {
    blockId: string
    version: number
    resolve: (geometry: CsgGeometry) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}
const pending = new Map<number, Pending>()
let requestId = 0
const key = Symbol.for('scad-ai-ide.markdown.host')
const host = window as unknown as Record<symbol, unknown>
host[key] = {
    setPreviewMode(blockId:string,modelVersion:number,mode:'preview'|'render'){api.postMessage({type:'setPreviewMode',blockId,modelVersion,mode})},
    queryTopology(blockId: string, version: number, planes: CsgClipPlane[] = []): Promise<CsgGeometry> {
        const id = ++requestId
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id)
                reject(new Error('Topology request timed out.'))
            }, 35000)
            pending.set(id, { blockId, version, resolve, reject, timer })
            api.postMessage({ type: 'queryTopology', blockId, modelVersion: version, requestId: id, planes })
        })
    },
    disposeBlock(blockId: string, version: number) {
        for (const [id, request] of pending)
            if (request.blockId === blockId && request.version === version) {
                clearTimeout(request.timer)
                request.reject(new Error('Preview closed.'))
                pending.delete(id)
            }
        api.postMessage({ type: 'cancelTopology', blockId, modelVersion: version })
    },
}

/** Patch ordinary Markdown while keeping unchanged live model containers in place. */
function patch(current: Node, next: Node) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
        current.parentNode?.replaceChild(next, current)
        return
    }
    if (current.nodeType === Node.TEXT_NODE) {
        if (current.textContent !== next.textContent) current.textContent = next.textContent
        return
    }
    if (!(current instanceof Element) || !(next instanceof Element)) return
    if (current.hasAttribute('data-owned-model') && current.hasAttribute('data-scad-model') && !next.hasAttribute('data-owned-disabled')) {
        const old = current.getAttribute('data-scad-model'),
            incoming = next.getAttribute('data-scad-model')
        if (!incoming || old === incoming) return
    }
    const preserve = new Set(current.hasAttribute('data-scad-panel') ? ['hidden'] : current.hasAttribute('data-scad-tab') ? ['aria-selected', 'tabindex'] : [])
    for (const attr of Array.from(current.attributes)) if (!next.hasAttribute(attr.name) && !preserve.has(attr.name)) current.removeAttribute(attr.name)
    for (const attr of Array.from(next.attributes)) if (!preserve.has(attr.name) && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value)
    if (current.hasAttribute('data-scad-model')) return
    const nodeKey = (node: Node) => (node instanceof Element ? (node.getAttribute('data-scad-block') ?? (node.id || undefined)) : undefined)
    const oldKeyed = new Map(
        Array.from(current.childNodes).flatMap((node) => {
            const key = nodeKey(node)
            return key ? [[key, node] as const] : []
        }),
    )
    const nextChildren = Array.from(next.childNodes)
    nextChildren.forEach((incoming, i) => {
        const key = nodeKey(incoming),
            existing = current.childNodes[i]
        const retained = key ? oldKeyed.get(key) : undefined
        if (retained) {
            if (retained !== existing) current.insertBefore(retained, existing ?? null)
            patch(retained, incoming)
        } else if (!existing || key || nodeKey(existing)) current.insertBefore(incoming, existing ?? null)
        else patch(existing, incoming)
    })
    while (current.childNodes.length > nextChildren.length) current.removeChild(current.lastChild!)
}

window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data
    if (message.type === 'markdownBody') {
        const container = document.getElementById('markdown-content'),
            template = document.createElement('main')
        if (!container) return
        template.id = container.id
        template.innerHTML = message.html
        patch(container, template)
        const mode = document.getElementById('markdown-mode') as HTMLSelectElement | null
        if (mode) mode.value = message.mode
        window.dispatchEvent(new Event('vscode.markdown.updateContent'))
    } else if (message.type === 'markdownVisibility') window.dispatchEvent(new CustomEvent('scad-markdown-visibility', { detail: !!message.active }))
    else if (message.type === 'ownedTopology') {
        const request = pending.get(message.requestId)
        if (!request || request.blockId !== message.blockId || request.version !== message.modelVersion) return
        pending.delete(message.requestId)
        clearTimeout(request.timer)
        if (message.geometry) request.resolve(message.geometry)
        else request.reject(new Error(message.error ?? 'Topology preparation failed.'))
    }
})
document.getElementById('markdown-mode')?.addEventListener('change', (event) => api.postMessage({ type: 'setMarkdownMode', mode: (event.target as HTMLSelectElement).value }))
document.addEventListener('click', (event) => {
    const anchor = (event.target as Element | null)?.closest('a'),
        href = anchor?.getAttribute('href')
    if (!href || href.startsWith('#')) return
    event.preventDefault()
    api.postMessage({ type: 'openLink', href })
})
window.addEventListener(
    'pagehide',
    () => {
        for (const request of pending.values()) {
            clearTimeout(request.timer)
            request.reject(new Error('Preview closed.'))
        }
        pending.clear()
    },
    { once: true },
)
api.postMessage({ type: 'ready' })
