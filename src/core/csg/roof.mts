// OpenSCAD fe482c3 Voronoi roof adapter. Native code and provenance: native/roof.cpp.
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises'
import type { CsgValue } from './parser.js'
interface Kernel {
    _malloc(bytes: number): number
    _free(pointer: number): void
    HEAPF64: Float64Array
    HEAP32: Int32Array
    ccall(name: string, output: string, input: string[], values: number[]): string
}
interface Roof {
    faces: number[][][]
    floor: number[][][]
    error?: string
}
let kernel: Kernel | undefined
export async function initializeRoof() {
    if (kernel) return
    const moduleUrl = new URL('./csg-kernel.mjs', import.meta.url)
    const init = (await import(moduleUrl.href)).default as (options: { wasmBinary: Uint8Array }) => Promise<Kernel>
    kernel = await init({ wasmBinary: await readFile(new URL('./csg-kernel.wasm', import.meta.url)) })
}
export function voronoiRoof(rings: number[][][], p: Record<string, CsgValue>): Roof {
    if (!kernel) throw new Error('Roof Voronoi kernel was not initialized.')
    const count = rings.reduce((s, r) => s + r.length, 0),
        points = kernel._malloc(count * 16),
        sizes = kernel._malloc(rings.length * 4)
    try {
        kernel.HEAPF64.set(rings.flat(2), points / 8)
        kernel.HEAP32.set(
            rings.map((r) => r.length),
            sizes / 4,
        )
        const result = JSON.parse(kernel.ccall('roof_voronoi', 'string', ['number', 'number', 'number', 'number', 'number', 'number'], [points, sizes, rings.length, Number(p.$fn ?? 0), Number(p.$fa ?? 12), Number(p.$fs ?? 2)])) as Roof
        if (result.error) throw new Error(`Roof Voronoi: ${result.error}`)
        return result
    } finally {
        kernel._free(points)
        kernel._free(sizes)
    }
}
