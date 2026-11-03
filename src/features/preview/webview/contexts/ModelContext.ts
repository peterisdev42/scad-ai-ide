import type { ClipPlane } from '../../../../core/preview/types'
import { createContext } from '@lit/context'
import { ModelFormat } from '../../shared/types/ModelFormat'
import type { PreviewBackend, PreviewTimings } from '../../shared/types/PreviewBackend'
import type { PreviewMode } from '../../shared/types/PreviewMode'
import type { GeometryData } from '../../../../core/preview/types'

export interface ModelContext {
    format: ModelFormat | null
    modelVersion?: number
    previewError?: string
    queryTopology?: (planes?: ClipPlane[]) => Promise<GeometryData>
    reportPerformance?: (timings: PreviewTimings) => void
    frameReady?: (graphics: 'webgpu' | 'webgl2', elapsedMs: number) => void
    base64Data: string | null
    isLoading: boolean
    loadingMessage: string
    backend?: PreviewBackend
    modeLinks?: Record<PreviewMode, string>
    previewMode?: PreviewMode
    setPreviewMode?: (mode: PreviewMode) => void
    exportEnabled?: boolean
    export: () => void
    sendToSlicer: () => void
}

export const modelContext = createContext<ModelContext>('model')
