// OpenSCAD FreetypeRenderer/DrawingCallback compatibility, fe482c3.
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises'
import initFreeType from '@zkl2333/freetype-wasm'
import * as hb from 'harfbuzzjs'
import { circularSegments } from './discretize.js'
import type { CsgValue } from './parser.js'

let freeType: ReturnType<typeof initFreeType> | undefined

const getFreeType = () => (freeType ??= readFile(new URL('./freetype.wasm', import.meta.url)).then((wasmBinary) => initFreeType({ wasmBinary })))

export async function inspectFontFaces(bytes: Uint8Array) {
    const ft = await getFreeType(),
        first = ft.newFace(bytes),
        count = Math.min(first.info().numFaces, 256),
        result: { index: number; family: string; style: string }[] = []
    try {
        result.push({ index: 0, family: first.info().familyName, style: first.info().styleName })
    } finally {
        first.destroy()
    }
    for (let index = 1; index < count; index++) {
        const face = ft.newFace(bytes, index)
        try {
            result.push({ index, family: face.info().familyName, style: face.info().styleName })
        } finally {
            face.destroy()
        }
    }
    return result
}

export async function textContours(bytes: Uint8Array, p: Record<string, CsgValue>, faceIndex = 0): Promise<number[][][][]> {
    const ft = await getFreeType()
    const face = ft.newFace(bytes, faceIndex)
    face.setCharSize(0, 100000, 100, 100)
    const m = ft.module
    const base = new hb.Font(new hb.Face(new hb.Blob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), faceIndex))
    base.setScale(138889, 138889)
    const font = base.subFont(),
        funcs = new hb.FontFuncs()
    const metrics = new Map<number, ReturnType<typeof face.loadGlyph>>()
    const load = (id: number) => {
        let glyph = metrics.get(id)
        if (!glyph) {
            glyph = face.loadGlyph({ index: id, render: false, flags: 2 })
            metrics.set(id, glyph)
        }
        return glyph
    }
    funcs.setNominalGlyphFunc((_font, unicode) => face.charIndex(unicode))
    funcs.setGlyphHAdvanceFunc((_font, glyph) => load(glyph).advance.x)
    funcs.setGlyphVOriginFunc((_font, glyph) => {
        const g = load(glyph).metrics
        return [g.horiBearingX - g.vertBearingX, g.horiBearingY + g.vertBearingY]
    })
    funcs.setGlyphVAdvanceFunc((_font, glyph) => -load(glyph).metrics.vertAdvance)
    funcs.setGlyphExtentsFunc((_font, glyph) => {
        const g = load(glyph).metrics
        return { xBearing: g.horiBearingX, yBearing: g.horiBearingY, width: g.width, height: -g.height }
    })
    font.setFuncs(funcs)
    const buffer = new hb.Buffer()
    buffer.addText(String(p.text ?? p.$0 ?? ''))
    if (typeof p.script === 'string') buffer.setScript(p.script)
    if (typeof p.language === 'string') buffer.setLanguage(p.language)
    if (typeof p.direction === 'string') buffer.setDirection(hb.Direction[p.direction.toUpperCase() as 'LTR' | 'RTL' | 'TTB' | 'BTT'] ?? hb.Direction.LTR)
    buffer.guessSegmentProperties()
    hb.shape(font, buffer)
    const size = typeof p.em === 'number' ? (p.em * 72) / 100 : typeof p.size === 'number' ? p.size : 10
    const factor = size / 100000,
        spacing = typeof p.spacing === 'number' ? p.spacing : 1
    const segments = Math.max(2, Math.floor(circularSegments(p, size) / 8) + 1)
    const glyphs: number[][][][] = []
    let contour: number[][] = [],
        contours: number[][][] = [],
        pen = [0, 0],
        advanceX = 0,
        advanceY = 0,
        xOffset = 0,
        yOffset = 0
    let ascent = 0,
        descent = 0,
        left = Infinity,
        right = -Infinity
    const readVector = (ptr: number) => [m.getValue(ptr, 'i32'), m.getValue(ptr + 4, 'i32')] as number[]
    const add = (v: number[]) => {
        contour.push([(v[0] + advanceX + xOffset) * factor, (v[1] + advanceY + yOffset) * factor])
        pen = v
    }
    const functions = [
        m.addFunction((to: number) => {
            if (contour.length) contours.push(contour)
            contour = []
            add(readVector(to))
            return 0
        }, 'iii'),
        m.addFunction((to: number) => {
            add(readVector(to))
            return 0
        }, 'iii'),
        m.addFunction((c1: number, to: number) => {
            const start = pen,
                control = readVector(c1),
                end = readVector(to)
            for (let i = 1; i <= segments; i++) {
                const t = i / segments
                add([0, 1].map((d) => start[d] * (1 - t) ** 2 + 2 * control[d] * (1 - t) * t + end[d] * t * t))
            }
            return 0
        }, 'iiii'),
        m.addFunction((c1: number, c2: number, to: number) => {
            const start = pen,
                a = readVector(c1),
                b = readVector(c2),
                end = readVector(to)
            for (let i = 1; i <= segments; i++) {
                const t = i / segments
                add([0, 1].map((d) => start[d] * (1 - t) ** 3 + 3 * a[d] * (1 - t) ** 2 * t + 3 * b[d] * (1 - t) * t * t + end[d] * t ** 3))
            }
            return 0
        }, 'iiiii'),
    ]
    const table = m._malloc(24),
        box = m._malloc(16)
    functions.forEach((ptr: number, i: number) => m.setValue(table + i * 4, ptr, 'i32'))
    m.setValue(table + 16, 0, 'i32')
    m.setValue(table + 20, 0, 'i32')
    const decompose = m.cwrap('FT_Outline_Decompose', 'number', ['number', 'number', 'number'])
    const getBox = m.cwrap('FT_Outline_Get_CBox', null, ['number', 'number'])
    try {
        for (const glyph of buffer.getGlyphInfosAndPositions()) {
            face.loadGlyph({ index: glyph.codepoint, render: false, flags: 0 })
            const slot = m.getValue(face.ptr + ft.offsets.FT_FaceRec.glyph, 'i32')
            if (m.getValue(slot + ft.offsets.FT_GlyphSlotRec.format, 'i32') !== 0x6f75746c) throw new Error('Text glyph has no outline.')
            // FT_Outline immediately follows bitmap_top in the wasm32 public slot.
            const outline = slot + ft.offsets.FT_GlyphSlotRec.bitmap_top + 4
            xOffset = glyph.xOffset ?? 0
            yOffset = glyph.yOffset ?? 0
            contours = []
            contour = []
            getBox(outline, box)
            const xmin = Math.floor(m.getValue(box, 'i32') / 64) * 64,
                xmax = Math.ceil(m.getValue(box + 8, 'i32') / 64) * 64,
                ymin = Math.floor(m.getValue(box + 4, 'i32') / 64) * 64,
                ymax = Math.ceil(m.getValue(box + 12, 'i32') / 64) * 64
            if (xmax > xmin && ymax > ymin) {
                ascent = Math.max(ascent, ymax)
                descent = Math.min(descent, ymin)
                left = Math.min(left, advanceX + xOffset + xmin)
                right = Math.max(right, advanceX + xOffset + xmax)
            }
            if (decompose(outline, table, 0)) throw new Error('Could not decompose text outline.')
            if (contour.length) contours.push(contour)
            glyphs.push(contours)
            advanceX += (glyph.xAdvance ?? 0) * spacing
            advanceY += (glyph.yAdvance ?? 0) * spacing
        }
        const vertical = p.direction === 'ttb' || p.direction === 'btt'
        const dx = vertical ? (p.halign === 'left' && Number.isFinite(left) ? -left * factor : p.halign === 'right' && Number.isFinite(right) ? -right * factor : 0) : p.halign === 'center' ? (-advanceX * factor) / 2 : p.halign === 'right' ? -advanceX * factor : 0
        const dy = vertical ? (p.valign === 'center' ? (-advanceY * factor) / 2 : p.valign === 'bottom' ? -advanceY * factor : 0) : p.valign === 'top' ? -ascent * factor : p.valign === 'bottom' ? -descent * factor : p.valign === 'center' ? (-(ascent + descent) * factor) / 2 : 0
        for (const rings of glyphs)
            for (const ring of rings)
                for (const point of ring) {
                    point[0] += dx
                    point[1] += dy
                }
        return glyphs
    } finally {
        m._free(table)
        m._free(box)
        functions.forEach((ptr: number) => m.removeFunction(ptr))
        face.destroy()
    }
}
