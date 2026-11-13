---
name: openscad-assembly-design
description: Inspect declared stable CAD parts, static assembly distances, contact, containment and constraint evidence without changing the acceptance baseline.
---

Read declarations with `scad_ai_ide_model_listParts`, including the checks section. Relative entry/file paths resolve from the project root containing `.scad`. Author IDs are scoped to the canonical Manifest URI; components and 3MF instances are hints, not stable parts. Do not auto-create a Manifest.

Call `scad_ai_ide_model_checkAssembly` with URI and the returned expectedManifestDigest. All declared parts must be non-empty valid raw solids. Read failed or unresolved issue evidence using `scad_ai_ide_model_getIssue`; use `scad_ai_ide_model_measure` and `scad_ai_ide_model_renderViews` on that reportId. Check current, units, precision, completeness, checked/unchecked pairs and all required statuses. Images are display evidence; they do not certify geometry. Overlap volume is not checked. Never sum possibly overlapping part volumes.

A positive surface distance can coexist with material overlap through containment. Contact requires proof of no interior overlap. Unknown, near-threshold or over-budget facts remain UNRESOLVED. Allowed contact does not waive a positive minimum clearance. Do not infer an overall PASS from successful tool execution or selected passing checks.
