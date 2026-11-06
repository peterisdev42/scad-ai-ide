# Diagnostics and outcomes

Source Problems are optional-annotation checks, not a SCAD compiler or a list of unmet user goals. No hint, expressions, legal reassignment, Hidden/Global, unlisted enum defaults and off-grid values are normal usage. A warning requires an explicitly written effective hint with a proven defect and a useful repair.

| Rule | Meaning | Automatic action |
|---|---|---|
| CUST-ANN-01 | Unclosed explicit hint | Close only a simple unambiguous hint |
| CUST-ANN-02 | Invalid standalone numeric step | Remove invalid step |
| CUST-ANN-03 | Empty enum options | Remove only simple empty entries |
| CUST-RANGE-01 | Reversed written bounds | Human review; never swap engineering limits automatically |
| CUST-RANGE-02 | Invalid explicit range step | Remove step, preserve supplied bounds |
| CUST-RANGE-03 | Default outside written bounds | Human review; effective native bounds may already include the default |
| CUST-TEXT-01 | Invalid text size annotation | Human review |
| CUST-TEXT-02 | Default exceeds written byte limit | Human review; never truncate source text |

Legacy CUSTOMIZER_* diagnostic codes remain available. Each core diagnostic also carries ruleId, evidence, range and fix safety. Review-only guidance is not an executable Quick Fix. Safe fixes are linked to the actual current diagnostic and committed through an opaque one-use editor command; stale source requires requesting the action again.

sourceValidate has independent sourceStatus (complete/incomplete), contractStatus (notRequested/unverified/matched/mismatch), qualityStatus (clear/warnings/errors), and per-target expectationResults.details. Legacy semanticPass and complete remain. Filtering warnings cannot establish a missing control. Incomplete or truncated results do not prove success. Source Apply may report applied=true with a failed postcondition: inspect the buffer and use Undo; never replay an old whole file.

Preset Problems use PRESET-001 invalid JSON, 002 structure, 003 set, 004 model value, 005 unknown parameter (requested review only), 006 missing option, 007 version compatibility. Only bound/explicitly selected JSON is analyzed. Preserve unknown parameters, sets and metadata; a source warning cannot authorize changing a preset file.
