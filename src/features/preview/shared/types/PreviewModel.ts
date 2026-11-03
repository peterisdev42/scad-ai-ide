import type { PreviewBackend } from './PreviewBackend'
import type { ModelFormat } from './ModelFormat'
export interface PreviewModel {
    pending?: boolean
    previewMode?: import('./PreviewMode').PreviewMode
    modeLinks?: Record<import('./PreviewMode').PreviewMode, string>
    host?: { blockId: string; modelVersion: number }
    format: ModelFormat
    content: string
    note?: string
    backend?: PreviewBackend
    dependencies?: { path: string; stamp: string }[]
}
