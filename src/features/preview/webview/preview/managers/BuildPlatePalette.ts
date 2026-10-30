import { Color } from 'three'

type Lab = [lightness: number, a: number, b: number]

// Björn Ottosson's public-domain linear-sRGB/Oklab transforms:
// https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
function toLab(color: Color): Lab {
    const l = Math.cbrt(0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b)
    const m = Math.cbrt(0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b)
    const s = Math.cbrt(0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function fromLab([lightness, a, b]: Lab): Color {
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
    return new Color().setRGB(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
}

/** Keep a gently theme-tinted charcoal surface; light themes invert lightness, never RGB hue. */
export function buildPlatePalette(source: Color, background: Color): { plate: Color; plateGrid: Color } {
    const [sourceL, a, b] = toLab(source)
    const darkL = toLab(background)[0] > 0.65 ? 1 - sourceL : sourceL
    // Compress every theme into L=0.40..0.46: approximately #484848..#585858.
    const lightness = 0.4 + 0.06 * Math.max(0, Math.min(1, darkL))
    const chroma = Math.hypot(a, b)
    const tint = chroma > 0.018 ? 0.018 / chroma : 1
    return {
        plate: fromLab([lightness, a * tint, b * tint]),
        plateGrid: fromLab([lightness + 0.13, a * tint * 0.6, b * tint * 0.6]),
    }
}
