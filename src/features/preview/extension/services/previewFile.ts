import { extname } from 'node:path'
import { ModelFormat } from '../../shared/types/ModelFormat'
import type { MeshFormat } from '../../shared/types/ModelFormat'

const meshFormats: Array<MeshFormat | ModelFormat.Nef3> = [ModelFormat.STL, ModelFormat.ThreeMF, ModelFormat.OFF, ModelFormat.OBJ, ModelFormat.VRML, ModelFormat.AMF, ModelFormat.POV, ModelFormat.Nef3]
const meshExtensions = new Map<string, MeshFormat | ModelFormat.Nef3>([
    ...meshFormats.map((format) => [`.${format}`, format] as const),
    ['.asciistl', ModelFormat.STL],
    ['.binstl', ModelFormat.STL],
])

export function meshFormat(path: string): MeshFormat | ModelFormat.Nef3 | undefined {
    return meshExtensions.get(extname(path).toLowerCase())
}

export function drawingFormat(path: string) {
    const extension = extname(path).toLowerCase()
    if (extension === '.dxf' || extension === '.nefdbg' || extension === '.pdf') return extension
}

export const previewEditorViewType = 'scad-ai-ide.preview.editor'
export const csgPreviewEditorViewType = 'scad-ai-ide.preview.csg'
export const meshPreviewEditorViewType = 'scad-ai-ide.preview.mesh'
export const drawingPreviewEditorViewType = 'scad-ai-ide.preview.drawing'

export function previewViewType(path: string, languageId?: string): string | undefined {
    if (meshFormat(path)) return meshPreviewEditorViewType
    if (drawingFormat(path)) return drawingPreviewEditorViewType
    if (/\.csg$/i.test(path)) return csgPreviewEditorViewType
    if (/\.scad$/i.test(path) || languageId === 'openscad') return previewEditorViewType
}

export function isPreviewEditor(viewType: string): boolean {
    return [previewEditorViewType, csgPreviewEditorViewType, meshPreviewEditorViewType, drawingPreviewEditorViewType].includes(viewType)
}
