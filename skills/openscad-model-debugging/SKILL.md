---
name: openscad-model-debugging
description: Diagnose and repair OpenSCAD compiler, assert, missing-library and unknown-symbol problems using current Problems and snapshot-bound official CLI evidence. Does not prove mesh validity, assembly clearance or printability.
---

# Diagnose and recheck an OpenSCAD model

Use for a broken SCAD/CSG model, compiler warnings, failed assertions or missing dependencies. Use existing Runtime/Libraries skills for installation and configuration; do not install dependencies implicitly.

1. Establish the explicit document URI, project and user constraints. Read current Problems if the host supports it; do not assume a particular built-in Problems tool name.
2. Call `scad_ai_ide_model_analyze` with `uri` and `mode: diagnostics`. No Preview panel is required. Read `executionStatus`, `overallStatus`, `complete` and `notExamined`; `ok: true` only means a report was delivered.
3. Use `scad_ai_ide_model_getIssue` with its reportId and issueId when bounded logs or related TRACE evidence are needed. Check `current` before relying on that evidence.
4. Repair the smallest evidenced source problem using the host's normal reviewed edits. Preserve Trust, Customizer CAS/one-use approvals, library locks, dimensions and acceptance constraints. Never reduce a tolerance or suppress a rule to obtain PASS.
5. Reanalyze the current document after every edit. A dirty root buffer is supported; unsaved include/use dependencies are not injected. `DIRTY_DEPENDENCY_NOT_EVALUATED` requires user-directed resolution, not an automatic save.
6. Stop on cancellation, refusal or unavailable runtime. After two consecutive attempts without fewer errors or another measurable improvement, report the blocker instead of looping. Do not invent source lines for model-level errors.
7. Report reportId/snapshotId, edits, current check status and all unresolved/not-examined categories. CSG PASS is not Full Render, valid mesh, correct spacing, visual review or printability.

Example: for “fix this assert”, analyze the explicit model, inspect the assert issue and TRACE, edit the source through the host, then analyze again. If compilation succeeds but the request also requires a 0.25 mm gap, say that assembly verification is not examined by this diagnostics-only tool; do not claim the complete design is verified.
