import type { CsgClipPlane } from '../../../../core/csg/types'
import { createContext } from '@lit/context'
import { ModelFormat } from '../../shared/types/ModelFormat'
import type { PreviewBackend, PreviewTimings } from '../../shared/types/PreviewBackend'
import type { PreviewMode } from '../../shared/types/PreviewMode'
import type { CsgGeometry } from '../../../../core/csg/types'

export interface ModelContext {
    format: ModelFormat | null
    modelVersion?: number
    previewError?: string
    queryTopology?: (planes?: CsgClipPlane[]) => Promise<CsgGeometry>
    reportPerformance?: (timings: PreviewTimings) => void
    frameReady?: (graphics: 'webgpu' | 'webgl2', elapsedMs: number) => void
    base64Data: string | null
    isLoading: boolean
    loadingMessage: string
    backend?: PreviewBackend
    modeLinks?:Record<PreviewMode,string>
    previewMode?: PreviewMode
    setPreviewMode?: (mode: PreviewMode) => void
    exportEnabled?: boolean
    export: () => void
    sendToSlicer: () => void
}

export const modelContext = createContext<ModelContext>('model')
