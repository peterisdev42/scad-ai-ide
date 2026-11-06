# Create and migrate

Good: `width = 40; // [10:5:100]` with expectation `{ "name": "width", "widget": "slider", "type": "number", "range": { "min": 10, "max": 100, "step": 5 } }`.
Bad: `width = 40; // width between 10 and 100` when a slider was requested.

Good: `shape = "round"; // [round:Round, square:Square]` creates a dropdown; expect both typed values and labels.
Bad: changing shape's source to a numeric code without checking model consumers.

Good: `hollow = true;` creates a checkbox. `offset = 2.5; // .5` creates a spinbox. `label = "Hi"; // 20` creates a textbox.
Bad: stringifying numeric defaults to satisfy model output.

For migration, analyze an existing literal, plan annotateExisting with supplied range, review diff, commit and validate. Ordinary trailing comments are preserved by refusing ambiguous replacements. The explicit `// range: 10..100 step 5` form can be converted safely through Quick Fix. Multiple group edits should include all affected targets; complex ungrouped moves may require normal editor review.
