# Public comparison — SCAD AI IDE
Reviewed: 2026-11-23. This is a limited review of **publicly documented** capabilities, not an exhaustive feature benchmark. Features and listings may change.

| Approach | Publicly documented strengths | When SCAD AI IDE is relevant |
| --- | --- | --- |
| [OpenSCAD desktop IDE](https://openscad.org/) | Official editor and CAD preview for OpenSCAD language | Developers preferring a VS Code workspace, managed runtimes/libraries and bounded native Agent Tools |
| [SCAD Preview](https://marketplace.visualstudio.com/items?itemName=sabhiram.scad-preview) | OpenSCAD WASM, Three.js live preview and STL export | Project toolchains, exact-version dependencies, Customizer and evidence-aware CAD workflows |
| [Carve](https://marketplace.visualstudio.com/items?itemName=Carve3D.carve) | Self-contained WebAssembly live preview without native CLI install | Workflows that intentionally select managed native CLI versions and integrate other services |
| [OpenSCAD Preview](https://marketplace.visualstudio.com/items?itemName=thijsdaniels.vscode-openscad-preview) | Three.js interactive preview, model colors, STL/3MF rendering | Shared environment/dependency management and the Agent/CAD verification chain |
| [OpenSCAD Renderer](https://marketplace.visualstudio.com/items?itemName=LuizBon.vscode-scad-renderer) | Three.js 3D preview and Copilot-style AI assistance | Registered native Language Model Tools backed by GUI services, safety gates and structured evidence |

Do not infer an absent competitor feature from a marketplace description that does not mention it. SCAD AI IDE is neither the first Three.js OpenSCAD viewer nor the only AI-assisted CAD extension. Some browser/WASM extensions offer a less demanding setup experience today; our project currently requires a source build.
