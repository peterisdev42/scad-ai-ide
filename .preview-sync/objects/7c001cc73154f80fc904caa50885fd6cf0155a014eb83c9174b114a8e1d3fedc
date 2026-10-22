import { Box3, Vector3 } from 'three'
import { BuildPlateOrigin } from '../../contexts/ViewOptionsContext'

// Match the existing printable grid; decorative plate tabs may extend outside it.
export const BUILD_PLATE_SIZE = 250
export function buildPlateOffset(origin: BuildPlateOrigin): Vector3 {
    const offset = origin === BuildPlateOrigin.LowerLeft ? BUILD_PLATE_SIZE / 2 : 0
    return new Vector3(offset, offset, 0)
}

/** Use the printable plate as the minimum framing area for models that fit in XY. */
export function buildPlateResetBounds(model: Box3, origin = BuildPlateOrigin.Center): Box3 {
    const size = model.getSize(new Vector3())
    if (!model.isEmpty() && (size.x > BUILD_PLATE_SIZE || size.y > BUILD_PLATE_SIZE)) return model.clone()
    const half = BUILD_PLATE_SIZE / 2
    const plate = new Box3(new Vector3(-half, -half, 0), new Vector3(half, half, 0)).translate(buildPlateOffset(origin))
    // Include height and any off-plate placement so a small displaced model is not cropped.
    return plate.union(model)
}
