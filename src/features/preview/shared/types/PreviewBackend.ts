/** Actual evaluator, independent of the user's requested mode. */
export interface PreviewBackend {
    kind: 'pending' | 'csg' | 'mesh' | 'fallback'
    reason?: string
    elapsedMs?: number
}
