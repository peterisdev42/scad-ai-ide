---
name: openscad-customizer
description: Author, inspect, repair and validate OpenSCAD Customizer source declarations rather than runtime parameter overrides.
applyTo: "**/*.scad"
---
When creating model parameters, use literal assignments and real Customizer hints before the first real opening brace. Preserve geometry, ordinary comments, include/use directives, file format and existing presets. Never evaluate expressions to manufacture literal defaults or guess engineering limits.

Use `scad_ai_ide_customizer_sourceAnalyze` with the explicit workspace file URI, including unsaved text. Use `scad_ai_ide_customizer_sourceApply` to plan supported minimal changes with the returned version/hash; review its diff and validation, then commit the opaque plan ID. On a stale source, analyze and plan again. Unsupported migrations need ordinary editor changes followed by validation. Read the openscad-customizer-authoring skill.

Use `scad_ai_ide_customizer_sourceValidate` with explicit expectations after writing. Inspect ok, operation.status, applied, semanticPass and complete. Failure, truncation or skipped checks cannot establish success. Runtime syntax, Customizer semantics, actual GUI controls and Preview geometry are separate evidence. Do not claim GUI/CLI verification from static analysis.

```openscad
/* [Dimensions] */
// Width in millimeters
width = 40; // [10:5:100]
// Numeric vector (1–4 components)
size = [20, 30, 40]; // [0:5:100]
/* [Appearance] */
// Select shape
shape = "round"; // [round:Round, square:Square]
hollow = true;
label = "Model"; // 20
/* [Hidden] */
internal_offset = 0.01;
```

A slider uses `[min:step:max]`, `[min:max]` or max-only `[max]`; step must be positive. Prefer an in-range default when authoring a new control; on-grid defaults are a convention, not a source-syntax requirement. Spinbox step: `offset = 2.5; // .5`. When authoring a dropdown, prefer values of the default's type and list the default explicitly; an unlisted default is added automatically and is not an error. Quote values containing delimiters. A string length is a nonnegative integer. Boolean defaults create checkboxes. Groups use standalone `/* [Name] */`; Hidden hides following parameters, Global is special. When a description is requested, prefer placing it before the declaration at column one; no description is required by default.

`// width between 10 and 100` is prose, not a slider hint. `wall = width / 10` is an expression, not a supported literal parameter. Avoid inventing controls for ordinary intermediate variables. For changing current values without editing source, use the existing openscad-customizer skill, Overrides and Preset tools. Overrides do not author source.

Source-diagnostic policy: do not report missing Customizer syntax, legal reassignment, expression defaults, Hidden/Global usage, unsupported forms, unlisted dropdown defaults or off-step defaults as source errors or basic-usage warnings. Warnings are only for concrete, repairable defects in an explicitly written annotation and include a suggestedFix. Read unmet explicit targets from sourceValidate.expectationResults; semanticPass=false is a target verification outcome, not proof of a syntax error. Optional annotation/group additions are refactors.
