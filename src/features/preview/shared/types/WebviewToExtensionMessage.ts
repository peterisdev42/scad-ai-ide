import type { PreviewTimings } from './PreviewBackend'
import type { CsgClipPlane } from '../../../../core/csg/types'
import type { PreviewMode } from './PreviewMode'

export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'setPreviewMode'; mode: PreviewMode }
    | { type: 'queryTopology'; modelVersion: number; planes?: CsgClipPlane[] }
    | { type: 'previewPerformance'; modelVersion: number; timings: PreviewTimings }
    | { type: 'frameReady'; modelVersion: number; graphics: 'webgpu' | 'webgl2'; elapsedMs: number }
    | {
          type: 'parameterChanged'
          name: string
          value: string | number | boolean | number[] | undefined
      }
    | { type: 'saveParameterSet'; name: string }
    | { type: 'promptSaveParameterSet' }
    | { type: 'deleteParameterSet'; name: string }
    | { type: 'applyParameterSet'; name: string | undefined }
    | { type: 'exportModel' }
    | { type: 'sendToSlicer' }
    | { type: 'persistScene'; snapshot: unknown }
    | { type: 'error'; message: string }
