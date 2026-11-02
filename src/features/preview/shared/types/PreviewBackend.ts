import type { PreviewTimings } from '../../../../core/preview/performance'
export type { PreviewTimings } from '../../../../core/preview/performance'

/** Actual evaluator, independent of the user's requested mode. */
export interface PreviewBackend {
    cacheHit?: boolean
    source?: 'mesh-file'
    kind: 'pending' | 'csg' | 'mesh' | 'unavailable'
    reason?: string
    elapsedMs?: number
    graphics?: 'webgpu' | 'webgl2'
    firstFrameMs?: number
    frameReady?: boolean
    timings?: PreviewTimings
}
