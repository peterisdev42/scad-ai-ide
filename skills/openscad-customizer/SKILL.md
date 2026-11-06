---
name: openscad-customizer
description: Inspect and change OpenSCAD model Customizer parameters or manage named JSON presets with SCAD AI IDE while preserving target identity and Preview behavior.
---
1. Open the intended SCAD document/source or custom Preview editor. Call `scad_ai_ide_customizer_state` for actual target URI, revision, parameter defaults/current values, types, ranges, choices and preset names. No Customizer panel is necessary.
2. Validate every value against the returned schema. Call `scad_ai_ide_customizer_set` with target, revision and values object. A batch validates atomically. Overrides are per target and drive Preview; they do not edit SCAD source.
3. Inspect state again to verify values. Re-read after STALE_STATE/TARGET_CHANGED; never retry a write against whichever document became active. Use `scad_ai_ide_customizer_reset` for one name or all overrides.
4. Use `scad_ai_ide_customizer_applyPreset`, `scad_ai_ide_customizer_createPreset`, `scad_ai_ide_customizer_savePreset`, `scad_ai_ide_customizer_deletePreset` with fresh target/revision and observed exact names. Empty apply name selects design defaults. Deletion independently asks the human for authorization.
5. `scad_ai_ide_customizer_importPresets` / `scad_ai_ide_customizer_exportPresets` take explicit workspace file URIs, not file-picker instructions. Preserve JSON format and other presets/metadata. Import selects a preset file without applying a named set; apply explicitly afterward. External file changes invalidate revisions.

Examples: “列出当前模型 Customizer 参数，把尺寸改为合法值并验证。” “Save these overrides as a named preset, without editing the SCAD source.”
