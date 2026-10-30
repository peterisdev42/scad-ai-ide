import { Color } from 'three'
import { buildPlatePalette } from './managers/BuildPlatePalette'

export interface Theme {
    background: Color
    foreground: Color
    grid: Color
    fog: Color
    plate: Color
    plateGrid: Color
    additive: Color
    subtractive: Color
    accent: Color
}

type ThemeStyles = Pick<CSSStyleDeclaration, 'getPropertyValue'>

export function contrastRatio(a: Color, b: Color): number {
    // Three.js colors are already in linear RGB.
    const luminance = (color: Color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    const x = luminance(a),
        y = luminance(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function distinguish(color: Color, background: Color, foreground: Color): Color {
    const result = color.clone()
    for (let step = 1; contrastRatio(result, background) < 3 && step <= 20; step++) {
        result.copy(color).lerp(foreground, step / 20)
    }
    return result
}

/** Resolve all viewport colors from the current VS Code theme, including sparse custom themes. */
export function readPreviewTheme(styles: ThemeStyles): Theme {
    const read = (names: string[], fallback: Color) => {
        for (const name of names) {
            const value = styles.getPropertyValue(`--vscode-${name}`).trim()
            if (value) return new Color(value)
        }
        return fallback.clone()
    }
    const background = read(['editor-background'], new Color())
    const foreground = read(['editor-foreground', 'foreground'], background.clone())
    const plateSource = background
        .clone()
        .lerp(read(['sideBar-background', 'panel-background'], background), 0.6)
        .lerp(foreground, 0.06)
    const { plate, plateGrid } = buildPlatePalette(plateSource, background)
    const accent = read(['charts-blue', 'focusBorder', 'button-background'], foreground)
    // A model is a shaded surface, not text: keep a light neutral base in both
    // themes instead of forcing text-level contrast and turning it dark gray.
    const luminance = (color: Color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    const brightest = Math.max(luminance(background), luminance(foreground))
    const gray = Math.max(0.5, Math.min(0.64, brightest * 0.9))
    const model = new Color().setScalar(gray)
    const plateGray = luminance(plate)
    // A very similar light background is separated by the shaded silhouette,
    // while a mid-gray custom theme benefits from a small base-color adjustment.
    if (Math.abs(gray - luminance(background)) < 0.08 || Math.abs(gray - plateGray) < 0.08) {
        model.setScalar(Math.min(0.85, gray + 0.12))
    }
    return {
        background,
        foreground,
        fog: background.clone(),
        grid: background.clone().lerp(foreground, 0.16),
        plate,
        plateGrid,
        additive: model,
        subtractive: distinguish(read(['charts-orange', 'charts-purple'], foreground), background, foreground),
        accent,
    }
}
