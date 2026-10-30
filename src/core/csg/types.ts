/** Binary geometry buffers encoded for the existing webview message transport. */
export interface CsgMesh {
    properties: string
    indices: string
    stride: number
}
export interface CsgScene {
    version: 1
    meshes: CsgMesh[]
}
