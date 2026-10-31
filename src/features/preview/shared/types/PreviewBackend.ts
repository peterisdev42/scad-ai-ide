export interface PreviewTimings {
    cliMs?: number
    resourcesMs?: number
    geometryMs?: number
    normalizationMs?: number
    uploadMs?: number
    shaderMs?: number
    interactiveFrameMs?: number
}

/** Actual evaluator, independent of the user's requested mode. */
export interface PreviewBackend {
    cacheHit?:boolean
    kind: 'pending' | 'csg' | 'mesh'
    reason?: string
    elapsedMs?: number
    graphics?: 'webgpu' | 'webgl2'
    firstFrameMs?: number
    frameReady?: boolean
    timings?: PreviewTimings
}
