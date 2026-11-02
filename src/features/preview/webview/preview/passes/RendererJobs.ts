import type { WebGPURenderer } from 'three/webgpu'

// Render targets, clear state and GPU error scopes belong to the renderer.
// A candidate preparation must not interleave with an awaiting CSG frame.
const jobs = new WeakMap<WebGPURenderer, Promise<void>>()
export function rendererBusy(renderer: WebGPURenderer) {
    return jobs.has(renderer)
}
export function withRenderer<T>(renderer: WebGPURenderer, job: () => Promise<T>): Promise<T> {
    const pending = (jobs.get(renderer) ?? Promise.resolve()).then(job)
    const tail = pending.then(
        () => {},
        () => {},
    )
    jobs.set(renderer, tail)
    void tail.then(() => {
        if (jobs.get(renderer) === tail) jobs.delete(renderer)
    })
    return pending
}
