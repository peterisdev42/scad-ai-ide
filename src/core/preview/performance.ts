/** Durations are wall-clock ms unless marked count. CPU submission is not GPU execution. */
export const PREVIEW_PHASES = {
    sourceMs: { label: 'Document / parameters', location: 'host' },
    selectionMs: { label: 'Exporter discovery', location: 'host' },
    runtimeMs: { label: 'Exporter verification', location: 'host' },
    exporterMs: { label: 'OpenSCAD .csgp export', location: 'host' },
    runtimeSelectionMs: { label: 'OpenSCAD runtime selection', location: 'host' },
    meshExportMs: { label: 'OpenSCAD STL / 3MF render', location: 'host' },
    meshReadMs: { label: 'STL / 3MF file read', location: 'host' },
    readMs: { label: '.csgp file read', location: 'host' },
    jsonParseMs: { label: '.csgp JSON decode / parse', location: 'host' },
    validationMs: { label: 'Schema validation', location: 'host' },
    conversionMs: { label: 'Prepared scene conversion', location: 'host' },
    dependenciesMs: { label: 'Dependency stamps', location: 'host' },
    cleanupMs: { label: 'Temporary file cleanup', location: 'host' },
    serializationMs: { label: 'Scene serialization', location: 'host' },
    resultParseMs: { label: 'Host result metadata parsing', location: 'host' },
    watcherMs: { label: 'Dependency watcher update', location: 'host' },
    encodeMs: { label: 'Host base64 encoding', location: 'host' },
    cliMs: { label: 'Host export / preparation subtotal', location: 'total' },
    transferSchedulingMs: { label: 'IPC / scheduling (estimate)', location: 'total' },
    decodeMs: { label: 'Viewer base64 decode', location: 'viewer' },
    viewerParseMs: { label: 'Viewer JSON parse', location: 'viewer' },
    meshParseMs: { label: 'STL / 3MF decode / parse', location: 'viewer' },
    viewerValidationMs: { label: 'Viewer scene validation', location: 'viewer' },
    resourcePreparationMs: { label: 'Mesh / Product GPU preparation', location: 'viewer' },
    viewerPreparationMs: { label: 'Viewer CPU preparation subtotal', location: 'total' },
    uploadMs: { label: 'Buffer upload submission (CPU)', location: 'viewer' },
    shaderMs: { label: 'Shader / pipeline preparation', location: 'viewer' },
    gpuWarmupMs: { label: 'GPU warmup completion wait', location: 'viewer' },
    booleanSubmitMs: { label: 'Goldfeather depth / stencil submission (CPU)', location: 'viewer' },
    colorSubmitMs: { label: 'Colour merge submission (CPU)', location: 'viewer' },
    meshSubmitMs: { label: 'Scene / mesh draw submission (CPU)', location: 'viewer' },
    gpuCompleteMs: { label: 'First-frame GPU completion wait', location: 'viewer' },
    presentationMs: { label: 'Browser frame callbacks', location: 'viewer' },
    firstFrameMs: { label: 'Viewer first frame total', location: 'total' },
    totalPreviewMs: { label: 'Request → first-frame acknowledgement', location: 'total' },
    interactiveFrameMs: { label: 'Latest sampled frame completion', location: 'total' },
    booleanPasses: { label: 'Depth / stencil draw passes', location: 'count' },
    readParseMs: { label: 'Read / parse subtotal', location: 'legacy' },
    topologyRequestMs: { label: 'Topology request', location: 'legacy' },
} as const
export type PreviewTimings = Partial<Record<keyof typeof PREVIEW_PHASES, number>>
/** Ordered by the actual path; mesh previews never expose exporter/Boolean stages. */
export const MESH_PREVIEW_PHASES = ['sourceMs', 'runtimeSelectionMs', 'meshExportMs', 'meshReadMs', 'dependenciesMs', 'cleanupMs', 'watcherMs', 'encodeMs', 'cliMs', 'transferSchedulingMs', 'decodeMs', 'meshParseMs', 'resourcePreparationMs', 'viewerPreparationMs', 'uploadMs', 'shaderMs', 'meshSubmitMs', 'gpuCompleteMs', 'presentationMs', 'firstFrameMs', 'totalPreviewMs', 'interactiveFrameMs'] as const satisfies readonly (keyof PreviewTimings)[]
export const CSG_PREVIEW_PHASES = Object.keys(PREVIEW_PHASES).filter((key) => !['runtimeSelectionMs', 'meshExportMs', 'meshReadMs', 'meshParseMs', 'meshSubmitMs'].includes(key) && PREVIEW_PHASES[key as keyof PreviewTimings].location !== 'legacy') as (keyof PreviewTimings)[]
export function validPreviewTimings(value: PreviewTimings): PreviewTimings {
    const result: PreviewTimings = {}
    for (const key of Object.keys(PREVIEW_PHASES) as (keyof PreviewTimings)[]) {
        const duration = value?.[key]
        if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && (PREVIEW_PHASES[key].location !== 'count' || Number.isSafeInteger(duration))) result[key] = duration
    }
    return result
}
