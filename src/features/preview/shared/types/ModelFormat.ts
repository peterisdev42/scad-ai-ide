export enum ModelFormat {
    Evidence = 'verification-evidence',
    ThreeMF = '3mf',
    STL = 'stl',
    OFF = 'off',
    OBJ = 'obj',
    VRML = 'wrl',
    AMF = 'amf',
    POV = 'pov',
    Nef3 = 'nef3',
    PreviewScene = 'csgp',
}

export type MeshFormat = Exclude<ModelFormat, ModelFormat.Evidence | ModelFormat.PreviewScene | ModelFormat.Nef3>
