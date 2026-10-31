# Local geometry runtime

OpenSCAD compatibility baseline: `fe482c342ea48bbe749563315741d0e58cdfd57f`.
The Voronoi roof kernel is adapted from `src/geometry/roof_vd.cc`; the TypeScript
curve, extrusion and text adapters carry the same source attribution. The SVG
adapter follows import_svg units and libsvg rectangle/ellipse tessellation; the
libsvg MIT notice is retained in licenses/libsvg-MIT.txt. OpenSCAD's
GPL-2.0-or-later COPYING is staged in `licenses/openscad/` at packaging time.

Rebuild the checked-in `csg-kernel.mjs` / `csg-kernel.wasm` with
`EMCC=/path/to/emcc BOOST_ROOT=/path/to/boost_1_88_0 npm run build:csg-kernel`.
Compiler: Emscripten 4.0.23. Boost: 1.88.0, source archive SHA-256
`46d9d2c06637b219270877c9e16155cbd015b6dc84349af064c088e9b5b12f7b`.
The build is a bounded-memory library, not an OpenSCAD executable. No CLI,
network access or submodule source reads occur when the worker loads it.

Other pinned runtime inputs are recorded in package-lock.json:

- Manifold 3.5.4 (Apache-2.0): solid and 2D local operations.
- straight-skeleton 3.0.0 (MIT wrapper): embedded CGAL 5.6 straight skeleton,
  Boost 1.81, GMP 6.2.1 and MPFR 4.2.0; upstream build instructions:
  https://github.com/StrandedKitty/straight-skeleton/blob/master/src/core/install_libraries.sh
- harfbuzzjs 1.6.4 (MIT): shaping, local WASM asset.
- @zkl2333/freetype-wasm 2.14.3 (MIT wrapper; FreeType license): outlines.
- Liberation fonts: copied from the pinned OpenSCAD font submodule;
  original font license is included in resources/fonts/LICENSE.

The upstream CGAL and FreeType licenses are retained in this directory. The
npm wrapper license alone does not replace the embedded libraries' licenses.
Their use and redistribution must preserve the corresponding source availability
and license notices; package sources/build recipes are linked above and the
ported sources/build script live in this repository.
