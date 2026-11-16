---
name: openscad-design-review
description: Compare frozen CAD baselines and detect required constraint regressions.
---

Read the baseline and target report identities, completeness, units and comparison scope. Use `scad_ai_ide_model_compare` with explicit frozen IDs. Retain a baseline only through `scad_ai_ide_model_manageReview` when authorized. A changed/removed constraint never counts as a repair. Protect independent stable parts with expectUnchangedPartIds. This summary does not prove that a region within a changed part stayed unchanged. Never claim a Boolean or sampled surface difference was checked. Read unresolved and incompatible reasons before recommending edits.
