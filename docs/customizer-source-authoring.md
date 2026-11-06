# Customizer source authoring

Historical implementation baseline: `4c92043e8b8ac9414f4135de053852bade2581db` and the 2026-11-06 Customizer Agent Authoring SPEC. Current 2026-11-09 architecture and acceptance supersede the historical verification below; see [ADR](customizer-architecture-adr.md), [acceptance](customizer-acceptance.md) and [progress](customizer-progress.md). The code is implemented; the SPEC's full real-model and cross-platform acceptance gate is **not yet complete**. Optional Hooks remain deferred.

## User workflow

For source authoring, use the bundled `openscad-customizer-authoring` Skill and `.scad` Instructions. For current parameter values and JSON presets, keep using the existing `openscad-customizer` Skill. The six added snippets use the `customizer-` prefix.

1. Analyze the explicit workspace `.scad` URI with `scad_ai_ide_customizer_sourceAnalyze`. It reads unsaved buffer text and returns actual controls and UTF-16 declaration/comment ranges, candidates, diagnostics, completeness, and URI/version/SHA-256 identity.
2. Plan with `scad_ai_ide_customizer_sourceApply`, mode `plan`, URI, exact `identity: {version, sha256}`, and semantic edits. Review preview and validation. Supported intent kinds: annotateExisting, insertLiteralParameter, changeWidget, moveGroup, hideParameter. Widgets: slider, spinbox, dropdown, checkbox, textbox, vector.
3. Commit with the same tool, mode `commit` and only planId. Plans expire after 120 seconds and are single use. Commit retains LM confirmation and independently requires Workspace Trust, canonical workspace membership and current source identity. It uses the editor Undo stack and never saves the document or modifies presets.
4. Validate with `scad_ai_ide_customizer_sourceValidate`, URI and explicit expectations. Expected fields include name, widget, type, group, literal default, range, step, choices and labels, text length, description and visibility. Always inspect ok, applied, semanticPass, postValidation, operation.status and complete.

```json
{
  "uri": "file:///workspace/model.scad",
  "expectations": [{
    "name": "width", "widget": "slider", "type": "number",
    "group": "Dimensions", "defaultValue": 40,
    "range": {"min": 10, "max": 100, "step": 5},
    "requireDescription": true
  }]
}
```

A successful static validation does not prove rendering, GUI interaction, geometry or printability. runtimeCheck/guiCheck are `notRequested`; use existing Preview/CLI and actual Customizer state separately when requested. Without expectations validation proves only the consistency of current recognized declarations. No control intent is inferred from ordinary prose or internal expressions.

## Editor behavior

Problems uses `scad-ai-ide-customizer` independently of LSP and AI providers, with 200ms debouncing, open/edit/save/configuration updates and close/dispose cleanup. Disable through `scad-ai-ide.customizer.sourceDiagnostics`. Files above 1 MiB are skipped by diagnostics and rejected by source tools; an incomplete analysis never passes validation.

Quick Fixes require matching current Problems diagnostics, use a rule-specific local proof, and commit an opaque one-shot command with version/SHA checks. Editor fixes support untitled and writable providers, including files outside the workspace and static edits in untrusted workspaces; Agent Source Apply retains its stricter workspace/trust/file restrictions. Optional refactors use the semantic planner:

- Remove a known invalid explicit slider step while preserving the supplied min/max.
- Refactor an explicit comment such as `// range: 10..100 step 5` into a slider hint.
- Refactor an existing number's current step explicit, or add a Global group when this cannot change other declarations.

No automatic fix invents a business range or changes an out-of-range default. Ordinary comments, geometry and includes remain intact. Off-grid defaults and expressions require an explicit editing decision.

## Safety and supported subset

The GUI and source analyzer share one scanner. Existing `parseCustomizer` output stays compatible. Source tools only operate on existing workspace files via extension-host `file:` URIs. Untitled and virtual providers are explicitly unsupported. Remote hosts must supply their local file URI semantics; real remote acceptance remains pending.

Literal types match the existing Parser: finite numbers (including supported exponent/hex forms), strings, booleans, 1–4 numeric vector elements. Groups, Hidden/Global, max-only sliders, numeric steps, text lengths and quoted dropdown delimiters are covered. Expressions and includes are never evaluated/followed. The [manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer) was checked as the syntax reference; this does not establish runtime equivalence for every OpenSCAD version.

Structured plans require an unambiguous declaration target and reject multiple-declaration edits, incomplete analyses, unsafe adjacent code, ambiguous trailing comments and group changes that alter other declarations. New insertion into an ungrouped header may require explicit grouping first. New literal parameters are not wired into geometry automatically. Inserted groups are scoped and non-target declarations retain their prior semantic records. File EOL, indentation, BOM, final newline and untouched text are preserved. Repeating the same supported intent produces no edits.

Analysis caching is bounded to 16 documents, keyed by URI/version/hash/options, and invalidated on changes/close. Bounds: 1 MiB/source; 500 returned parameters/candidates; 100 Agent diagnostics (200 editor); 64 KiB across all result collections, 8 KiB per entry; 50 edits/plan; 32 pending plans; 32 KiB preview; 120-second expiry. Omitted metadata sets complete=false. A failed real postcondition reports the actual applied state without overwriting concurrent changes; use Undo or inspect and replan. Untrusted workspaces permit read-only source analysis/validation but deny both sourceApply modes.

## Historical verification evidence (prior SPEC, not current acceptance)

The reproducible commands are in [agent-verification.md](agent-verification.md). Local evidence is stored under `.build/customizer-source-*` (ignored artifacts). Run with an isolated trusted workspace and profile; no user source fixture is committed or implicitly saved.

| Layer | Current result |
|---|---|
| Manifest/type/lint/build | Passed; 40 tools, 2 Instructions, 5 Skills |
| Core source suites | Passed: 16 cases covering widgets, syntax boundaries, UTF-16/CRLF, diagnostics, limits, edits, idempotence and expectations |
| Capability/service suites | Passed: 21 cases including actual unsaved/CAS/security/postcondition/Quick Fix behavior through injected hosts |
| Existing unit/library/preview regressions | 288 passed locally; 3 existing environment-dependent library cases skipped |
| Customizer browser regressions | 24 passed |
| AI Panel browser regression | Passed with generated tool/resource counts |
| Actual Extension Host source path | 26/26 full Host tests passed on BOTH VS Code 1.140.0 and 1.145.1 with clean profiles; includes diagnostics/Quick Fix, GUI schema parity and real Markdown CLI rendering |
| Performance | 107,124-byte fixture, 25 samples, local p95 approximately 0.9ms on macOS arm64 / Node 24.16.0; CI measurement is independent |
| Real native Agent + local Ollama source workflows | Not accepted; no new model-driven source workflow evidence collected |
| Linux/Windows/Remote SSH/WSL/container | Not accepted locally |

The final 4.52 MB VSIX passed resource inspection and installed Production verification, including actual source analyze/plan/commit/validate, single-use rejection, unsaved-buffer and unchanged-disk checks. Isolated installed evidence: `.build/customizer-source-installed.log`; Host evidence: `.build/customizer-source-host-clean-1.140.log` and `.build/customizer-source-host-clean-1.145.log`. The installed profile reported zero available chat models; these results establish tool execution, not model-driven source authoring. Prior host failures must be distinguished from source-path failures; no model reply or tool-discovery result replaces end-to-end authoring evidence.


## Historical local acceptance record (not current acceptance)

Commands completed: `check:agents`, `check-types`, `lint`, `npm test`, `test:capabilities`, `test:customizer:source`, `test:customizer`, `test:agents:ui`, `package`, actual VSIX packaging, `verify:agents:vsix`, `test:agents:installed`, and full `test:integration` on the minimum and current installed hosts. The CI contracts job now schedules Ubuntu/macOS/Windows; those remote jobs have not run locally.

An earlier full Host run using the pre-existing test profile had a native keyboard timeout. The same test passed against both the baseline bundle and current bundle using a fresh profile; both complete clean-profile runs subsequently passed all 26 tests. Initial Markdown Preview verification needed `SCAD_PREVIEW_EXPORTER`; using the available 2026.11-RC0 Exporter passed real rendering on both hosts. GUI processes required execution outside the filesystem sandbox. These initial failures are retained in ignored logs rather than described as successful runs.

For reproducible Host runs, set `SCAD_TEST_WORKSPACE` and `SCAD_TEST_USER_DATA` to isolated directories, `SCAD_VSCODE_EXECUTABLE` to the host executable, and `SCAD_PREVIEW_EXPORTER` to the real Exporter. Source authoring tests skip explicitly when no trusted workspace is provided. The installed script creates its own temporary profile/workspace and verifies service trust rejection separately in the unit suite.

Remaining SPEC acceptance: official native Agent plus a configured local Ollama tool-calling source-generation/repair matrix with raw inputs/outputs and actual resulting files; Linux/Windows native runs; Remote SSH/WSL/container runs. These remain unaccepted, and the SPEC must not be marked fully Implemented on the strength of local contract/Host/VSIX results alone. Optional Hooks are not part of this delivery.


Customizer diagnostics follow the 2026-11-09 policy: absence of Customizer syntax never produces a diagnostic. Repeated assignments, expression defaults, Hidden/Global use, local names, unsupported forms, defaults automatically inserted into dropdowns and off-step defaults are normal usage, not source errors. Only an explicitly written, effective Widget hint with a concrete malformed syntax or conflicting range/length constraint receives a warning; each warning includes a specific `suggestedFix` and must disappear after that repair or removal of the annotation. Superseded annotations are ignored. No basic-usage information/hint messages are emitted.

Explicit target verification remains independent: `sourceValidate` returns `semanticPass`, checked/matched counts and bounded `expectationResults` with per-target matched/issues/range. An unmet Slider/group/description target is not placed in source diagnostics and is never labeled a syntax error. With no expectations, ordinary valid SCAD passes without requiring Customizer annotations. Safe structured edits still refuse ambiguous multi-declaration targets and retain trust/CAS checks; an operation refusal is not an editor syntax diagnosis. Adding optional groups or hints is a Refactor action, not a Quick Fix implying existing source is erroneous.


A comment such as `// [0:22] IDs in Assembly.md; 0 shows the selected group` already has a closing bracket and must not produce a missing-bracket warning. The current Parser accepts a bracketed hint only when it occupies the complete inline comment; trailing prose is left as unsupported/ordinary comment text rather than diagnosed or silently reinterpreted. For a recognized Slider, put the explanation on the preceding comment line and keep `parameter = 0; // [0:22]` alone on the declaration line. Structured Widget edits refuse to discard such trailing prose. Brackets inside quoted enum values/labels are ignored when checking for the true closing delimiter.


## Current semantic and validation contract

Declared annotation bounds remain author intent and diagnostic evidence; effective native numeric bounds include defaults. Numeric step is an interaction increment, not a validity grid. The native StringParameter constructor preserves the declared maximumSize due to parameter shadowing; native import truncates UTF-8 bytes, while the IDE explicitly rejects oversize input without loss. Multiline strings retain line breaks in both GUIs. See pinned source and 41-case differential evidence in the architecture report.

Source validation returns sourceStatus, contractStatus and qualityStatus, plus legacy semanticPass/complete. Each target has details with stable mismatch codes and ranges. No expectations means contractStatus=notRequested; incomplete analysis yields unverified target checks. Default Problems remains about explicit annotation defects, never unmet optional contracts.

Preset diagnostics use a separate OpenSCAD Preset collection and PRESET-001..007 identifiers. Only the explicitly bound JSON is diagnosed; its unsaved buffer takes precedence for analysis without applying values. Unknown versions remain preserved/read-only. Preview, sidebar and Agent delegate selections/writes to the same host domain. Writes stage and compare original bytes before provider rename, with extension-local serialization; the final read/rename interval is not a cross-process CAS.
