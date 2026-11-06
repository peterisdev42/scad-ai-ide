# Create and migrate

Good: `width = 40; // [10:5:100]` with expectation `{ "name": "width", "widget": "slider", "type": "number", "range": { "min": 10, "max": 100, "step": 5 } }`.
Bad: `width = 40; // width between 10 and 100` when a slider was requested.

Good: `shape = "round"; // [round:Round, square:Square]` creates a dropdown; expect both typed values and labels.
Bad: changing shape's source to a numeric code without checking model consumers.

Good: `hollow = true;` creates a checkbox. `offset = 2.5; // .5` creates a spinbox. `label = "Hi"; // 20` creates a textbox.
Bad: stringifying numeric defaults to satisfy model output.

For migration, analyze an existing literal, plan annotateExisting with supplied range, review diff, commit and validate. Ordinary trailing comments are preserved by refusing ambiguous replacements. The explicit `// range: 10..100 step 5` form can be converted safely through Quick Fix. Multiple group edits should include all affected targets; complex ungrouped moves may require normal editor review.

## Source tool arguments

Source Apply accepts a structured object. It is not a shell command and has no `command`, `id`, `includeWarnings` or `maxDiagnostics` field. `mode` is exactly `plan` or `commit`.

For a plan, supply `uri`, `identity: {version, sha256}` copied from the latest Source Analyze, and an `edits` array. Each edit has `kind` and `name`; a widget edit also has `widget`. For example, an edit entry for an existing literal is:

```json
{"kind":"annotateExisting","name":"width","widget":"slider","range":{"min":10,"max":100,"step":5},"description":"Width in millimeters","group":"Dimensions"}
```

Do not copy a made-up version, hash or plan ID. Put the returned source identity in the plan request. After reviewing a successful plan, commit with only `{"mode":"commit","planId":"the actual returned planId"}`. A JSON command embedded inside a string is not a valid plan. A failed tool call does not establish an edit; inspect the structured result and correct the specific input or report the failure.

Successful plans also return `data.continuation = {tool, input, requiresReview:true}`. After reviewing the diff, invoke that registered tool with the returned `input` unchanged. Review metadata is not authorization and is not a Commit field. Non-retryable manual-review failures on unchanged source require an explanation, not an identical retry; when the task prohibits other writers, leave the file intact and describe manual handling. Any later manual edit requires a fresh Analyze identity.
