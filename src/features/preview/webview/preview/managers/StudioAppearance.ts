import { NeutralToneMapping, PMREMGenerator, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/** Neutral satin surface, with broad highlights instead of a metallic or chalky finish. */
export const studioSurface = { metalness: 0, roughness: 0.45 } as const

/** Locally generated softboxes provide neutral fill/reflections without downloading an HDR image. */
export function createStudioEnvironment(renderer: WebGLRenderer) {
    renderer.toneMapping = NeutralToneMapping
    renderer.toneMappingExposure = 0.95
    const generator = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    try {
        return generator.fromScene(room, 0.04)
    } finally {
        room.dispose()
        generator.dispose()
    }
}
