# Repair and verification

`[10:0:100]` has an invalid step. Quick Fix removes the invalid explicit step, retaining the range. It never chooses a new engineering threshold. A default outside an explicitly written range can be repaired by changing that range or default; no engineering value is chosen automatically. Off-grid defaults do not generate diagnostics. Expression defaults are not evaluated or silently frozen.

Ordinary variables and prose do not establish control intent. Unsupported expressions with explicit hints are information-level candidates. Preserve comments, group scope, geometry and preset files. New inserted parameters do not automatically wire themselves into geometry.

Analysis can be incomplete because of syntax, oversized text, or bounded output. Treat complete=false as unverified. Warning filtering never turns a failed validation into a pass. CLI success does not prove the requested controls; source validation does not prove rendering or physical correctness.


Missing Customizer annotations, legal repeated assignments, expression defaults, Hidden groups, unsupported forms and off-step defaults are not source errors and must not produce basic-usage warnings. Dropdown defaults may be added automatically by the Parser. Diagnose only concrete defects in an explicitly written effective annotation, with a specific repair. Optional groups/hints are authoring refactors, not corrections the user must make.

For an explicit target, inspect `expectationResults` and `semanticPass`. Report unmatched requirements as target results rather than syntax errors or Problems diagnostics. Structured edits may still refuse an ambiguous multi-declaration target; use reviewed ordinary edits instead of interpreting that refusal as invalid SCAD.
