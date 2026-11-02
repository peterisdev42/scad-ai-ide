import { execFileSync } from 'node:child_process'
import { accessSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Reproducible inputs: Emscripten 4.0.23, Boost 1.88.0, pinned source below.
const emcc = process.env.EMCC || 'emcc'
const boost = process.env.BOOST_ROOT
if (!boost) throw new Error('Set BOOST_ROOT to Boost 1.88.0 (archive sha256: 46d9d2c06637b219270877c9e16155cbd015b6dc84349af064c088e9b5b12f7b).')
accessSync(join(boost, 'boost/polygon/voronoi.hpp'))
mkdirSync('resources/csg', { recursive: true })
execFileSync(emcc, [resolve('src/core/csg/native/roof.cpp'), '-I' + resolve(boost), '-O3', '-std=c++17', '-fexceptions', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=536870912', '-sEXPORTED_FUNCTIONS=["_roof_voronoi","_malloc","_free"]', '-sEXPORTED_RUNTIME_METHODS=["ccall","HEAPF64","HEAP32"]', '-o', resolve('resources/csg/csg-kernel.mjs')], { stdio: 'inherit' })
