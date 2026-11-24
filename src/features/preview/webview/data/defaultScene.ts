import { SceneObjectDescriptor } from '../contexts/SceneContext'

export const DEFAULT_CAMERA_ID = 'camera-default'

export const defaultCamera: SceneObjectDescriptor = {
    id: DEFAULT_CAMERA_ID,
    type: 'camera',
    name: 'Camera 1',
    visible: true,
    active: true,
}

export const defaultScene: SceneObjectDescriptor[] = [
    defaultCamera,
    {
        id: 'ambient-light-default',
        type: 'ambient-light',
        name: 'Ambient Light 1',
        visible: false,
        active: true,
    },
    {
        id: 'directional-light-default',
        type: 'directional-light',
        name: 'Directional Light 1',
        visible: false,
        active: true,
    },
    {
        id: 'spot-light-default',
        type: 'spot-light',
        name: 'Spot Light 1',
        visible: false,
        active: true,
    },
    {
        id: 'point-light-default',
        type: 'point-light',
        name: 'Point Light 1',
        visible: false,
        active: true,
    },
]
