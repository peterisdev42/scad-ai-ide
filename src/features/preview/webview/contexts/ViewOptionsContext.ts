import { createContext } from '@lit/context'

export enum Environment {
    None = 'none',
    Grid = 'grid',
    BuildPlate = 'buildPlate',
}

export enum BuildPlateOrigin {
    Center = 'center',
    LowerLeft = 'lowerLeft',
}

export enum RenderMode {
    Solid = 'solid',
    Wireframe = 'wireframe',
    XRay = 'xray',
}

export enum CameraMode {
    Perspective = 'perspective',
    Orthographic = 'orthographic',
}

export interface ViewOptions {
    environment: Environment
    buildPlateOrigin: BuildPlateOrigin
    renderMode: RenderMode
    camera: CameraMode
    modelColor: string | null
    shadows: boolean
    fogDensity: number
}

export interface ViewOptionsContext {
    options: ViewOptions
    get: <K extends keyof ViewOptions>(key: K) => ViewOptions[K]
    is: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => boolean
    set: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void
}

export const viewOptionsContext = createContext<ViewOptionsContext>('view-options')
