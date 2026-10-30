import { createContext } from '@lit/context'
import { ModelFormat } from '../../shared/types/ModelFormat'
import type { PreviewBackend } from '../../shared/types/PreviewBackend'
import type { PreviewMode } from '../../shared/types/PreviewMode'

export interface ModelContext {
    format: ModelFormat | null
    base64Data: string | null
    isLoading: boolean
    loadingMessage: string
    backend?: PreviewBackend
    previewMode?: PreviewMode
    setPreviewMode?: (mode: PreviewMode) => void
    exportEnabled?: boolean
    export: () => void
    sendToSlicer: () => void
}

export const modelContext = createContext<ModelContext>('model')
