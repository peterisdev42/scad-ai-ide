import type { PreviewBackend } from './PreviewBackend'
import type { ModelFormat } from './ModelFormat'
import type { CsgGeometry } from '../../../../core/csg/types'
export interface PreviewModel {
    previewMode?:import('./PreviewMode').PreviewMode
    modeLinks?:Record<import('./PreviewMode').PreviewMode,string>
    host?: { blockId: string; modelVersion: number }
    format: ModelFormat
    content: string
    note?: string
    backend?: PreviewBackend
    topology?: CsgGeometry
    topologyError?: string
    dependencies?: { path: string; stamp: string }[]
}
