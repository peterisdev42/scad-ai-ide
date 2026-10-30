import type { PreviewBackend } from './PreviewBackend'
import type { ModelFormat } from './ModelFormat'
export interface PreviewModel {
    format: ModelFormat
    content: string
    note?: string
    backend?: PreviewBackend
}
