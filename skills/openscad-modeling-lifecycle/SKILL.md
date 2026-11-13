---
name: openscad-modeling-lifecycle
description: Repair authorized CAD geometry and recheck every required static assembly constraint against an unchanged Manifest baseline.
---

1. Read parts and checks with `scad_ai_ide_model_listParts`; record manifestDigest and author IDs. Missing declarations require user-authored configuration.
2. Run `scad_ai_ide_model_checkAssembly` with expectedManifestDigest. Read issue IDs through `scad_ai_ide_model_getIssue`. Distinguish FAIL from incomplete or stale evidence.
3. Edit only geometry the user authorized. Never automatically modify the Manifest, thresholds, transforms, IDs, required flags or expected results; never remove a part, disable safety prerequisites or repair a mesh to obtain PASS. Do not save user buffers without authorization.
4. Recheck using the identical expectedManifestDigest, with no pair-only shortcut or threshold override. CONSTRAINT_BASELINE_CHANGED stops repair. Require a new current snapshot, every required check and base-part prerequisite passing, and no incomplete input.
5. Perform at most three autonomous repair rounds; stop after two consecutive rounds without verifiable progress. Report remaining issues honestly. Report diagnostic, mesh, assembly, image, Agent and platform evidence separately. Historical reportId reads never rerun compilation.
