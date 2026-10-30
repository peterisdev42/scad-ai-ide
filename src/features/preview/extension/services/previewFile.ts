import { ModelFormat } from '../../shared/types/ModelFormat'

export function meshFormat(path: string): ModelFormat | undefined {
    if (/\.stl$/i.test(path)) return ModelFormat.STL
    if (/\.3mf$/i.test(path)) return ModelFormat.ThreeMF
    return undefined
}

export const previewEditorViewType = 'scad-ai-ide.preview.editor'
export const meshPreviewEditorViewType = 'scad-ai-ide.preview.mesh'
export function isPreviewEditor(viewType: string): boolean {
    return viewType === previewEditorViewType || viewType === meshPreviewEditorViewType
}
