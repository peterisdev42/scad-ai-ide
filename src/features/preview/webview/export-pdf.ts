import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'

const api = acquireVsCodeApi()
const canvas = document.querySelector<HTMLCanvasElement>('#pdf-page')!
const position = document.querySelector<HTMLSpanElement>('#position')!
const previous = document.querySelector<HTMLButtonElement>('#previous')!
const next = document.querySelector<HTMLButtonElement>('#next')!
const error = document.querySelector<HTMLParagraphElement>('#error')!
const workerPath = document.querySelector<HTMLScriptElement>('script[data-worker]')!.dataset.worker!

let workerSource: Promise<string> | undefined
let loading: PDFDocumentLoadingTask | undefined
let pdf: PDFDocumentProxy | undefined
let activeRender: RenderTask | undefined
let documentVersion = 0
let renderVersion = 0
let pageNumber = 1

function fail(message: string) {
    error.textContent = message
    error.hidden = false
    canvas.hidden = true
    position.textContent = 'PDF preview unavailable'
    previous.disabled = next.disabled = true
}

async function render() {
    if (!pdf) return
    const version = ++renderVersion
    activeRender?.cancel()
    try {
        const page = await pdf.getPage(pageNumber)
        if (version !== renderVersion) return
        const size = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(size.width, size.height)) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        activeRender = page.render({ canvas, viewport })
        await activeRender.promise
        if (version !== renderVersion) return
        canvas.hidden = false
    } catch (cause) {
        if (version === renderVersion) fail(cause instanceof Error ? cause.message : String(cause))
    }
}

function selectPage(number: number) {
    if (!pdf || number < 1 || number > pdf.numPages) return
    pageNumber = number
    position.textContent = `${number} / ${pdf.numPages}`
    previous.disabled = number === 1
    next.disabled = number === pdf.numPages
    void render()
}

async function reset() {
    renderVersion++
    activeRender?.cancel()
    activeRender = undefined
    const oldLoading = loading
    loading = undefined
    pdf = undefined
    canvas.hidden = true
    previous.disabled = next.disabled = true
    await oldLoading?.destroy()
}

async function open(bytes: Uint8Array) {
    const version = ++documentVersion
    error.hidden = true
    position.textContent = 'Loading PDF…'
    try {
        await reset()
        workerSource ??= fetch(workerPath).then(async (response) => {
            if (!response.ok) throw new Error('Could not load the PDF renderer.')
            return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: 'text/javascript' }))
        })
        GlobalWorkerOptions.workerSrc = await workerSource
        if (version !== documentVersion) return
        loading = getDocument({ data: bytes, disableFontFace: true, useWasm: false })
        const result = await loading.promise
        if (version !== documentVersion) return
        pdf = result
        selectPage(1)
    } catch (cause) {
        if (version === documentVersion) fail(cause instanceof Error ? cause.message : String(cause))
    }
}

previous.addEventListener('click', () => selectPage(pageNumber - 1))
next.addEventListener('click', () => selectPage(pageNumber + 1))
window.addEventListener('message', (event: MessageEvent<{ type: 'pdf'; base64: string } | { type: 'error'; message: string }>) => {
    if (event.data.type === 'pdf') void open(Uint8Array.from(atob(event.data.base64), (character) => character.charCodeAt(0)))
    else if (event.data.type === 'error') {
        documentVersion++
        void reset().catch(() => {})
        fail(event.data.message)
    }
})
api.postMessage({ type: 'ready' })
