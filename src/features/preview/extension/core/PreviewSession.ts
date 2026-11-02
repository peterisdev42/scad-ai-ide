import type { ScadSession } from './ScadSession'
import type { ModelFormat } from '../../shared/types/ModelFormat'

/** The shared view consumes model events; parameter editing is available only for SCAD. */
export type PreviewSession = Pick<ScadSession, 'documentUri' | 'currentParameters' | 'currentOverrides' | 'currentParameterSets' | 'activeSetName' | 'onRenderStarted' | 'onRenderCompleted' | 'onRenderError' | 'onParametersChanged' | 'onLog' | 'exportFormat'> &
    Partial<Pick<ScadSession, 'updateParameterValue' | 'saveParameterSet' | 'deleteParameterSet' | 'applyParameterSet' | 'previewMode' | 'setPreviewMode' | 'renderBackend' | 'onBackendChanged' | 'acceptFrame' | 'acceptPerformance'>> & {
        readonly sourceFormat?: ModelFormat
    }
