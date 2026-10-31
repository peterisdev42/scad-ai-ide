import { ModelFormat } from './ModelFormat'
import { ScadParameter } from './ScadParameter'
import type { PreviewBackend } from './PreviewBackend'
import type { PreviewMode } from './PreviewMode'
import type { CsgGeometry } from '../../../../core/csg/types'

export type ExtensionToWebviewMessage =
    | { type: 'ready' }
    | { type: 'previewMode'; mode: PreviewMode;links?:Record<PreviewMode,string> }
    | { type: 'previewBackend'; backend: PreviewBackend }
    | { type: 'topology'; modelVersion: number; geometry?: CsgGeometry; error?: string }
    | { type: 'emptyModel'; message: string }
    | { type: 'renderError'; message: string }
    | { type: 'previewIssue'; message: string }
    | { type: 'loadingState'; loading: boolean; message?: string }
    | {
          type: 'update'
          content: string // base64 payload
          format: ModelFormat
          modelVersion?: number
      }
    | {
          type: 'updateParameters'
          parameters: ScadParameter[]
          parameterSets: Record<string, Record<string, string>>
          activeSetName: string | undefined
          overrides: Record<string, string | number | boolean | number[]>
      }
    | { type: 'error'; message: string }
    | { type: 'log'; message: string }
    | { type: 'loadScene'; snapshot: unknown | null }
