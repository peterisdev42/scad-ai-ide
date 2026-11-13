---
name: openscad-geometry-verification
description: Verify and measure raw SCAD/CSG/STL/3MF geometry, inspect mesh issues and request snapshot-bound multi-view PNG evidence without opening Preview.
---

Use `scad_ai_ide_model_analyze` with an explicit workspace URI and `mode="verify"`.
Standalone STL/3MF needs no OpenSCAD runtime; SCAD Full Render and PNG require the selected official CLI. All operations require Workspace Trust.

Read executionStatus, overallStatus, completeness, units, quality, checks, incomplete and notExamined before drawing conclusions. `ok:true` only means the request returned a report. UNRESOLVED, SKIPPED, missing evidence, historical results and unfinished budgets are never PASS. Measurements describe the exported mesh, not an exact analytic surface. SCAD/STL defaults to modelUnits; declare mm only with user evidence. 3MF honors metadata units.

Use `scad_ai_ide_model_measure` by reportId to project existing bounds, area and volume. Signed volume can be negative. Physical volume requires certified closure, manifold topology, no self-intersection, shell relations and correct material winding. Never take an absolute signed volume as a repair. Read `scad_ai_ide_model_getIssue` with report/issue IDs for bounded triangle/component evidence; use cursor/limit when provided.

Use `scad_ai_ide_model_renderViews` by reportId for iso/front/top PNGs from the same frozen mesh. Metadata is the default; request delivery="inline" explicitly for native image parts. Inspect availability, framing, source/rendered mesh hashes and display quantization. Images cannot grant a visual verification PASS. Missing PNG capability does not invalidate completed geometry checks.

Use host editing tools to fix authorized source problems, then reanalyze the URI and compare snapshot IDs. Never automatically weld, delete faces, fill holes, reorient or otherwise repair raw mesh evidence; never lower constraints or remove asserts to obtain PASS. Report unsupported assembly, thickness and printability checks explicitly. Report IDs never trigger implicit recompilation. If evidence expired, explicitly verify the current URI.
