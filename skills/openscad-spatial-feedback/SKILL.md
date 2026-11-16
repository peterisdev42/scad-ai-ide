---
name: openscad-spatial-feedback
description: Request human surface feedback in frozen evidence views and respect stale anchors.
---

Read `scad_ai_ide_model_getFeedback` before requesting interaction. Use `scad_ai_ide_model_requestPointing` to ask the human to point and explicitly submit in the frozen evidence view; do not invent coordinates or simulate human approval. A current snapshot is required, not overall PASS. Anchors identify frozen triangles and parts, not SCAD parameter lines. Stale feedback cannot become current merely because source content was restored. Only propose a proven identical-local-mesh rigid remap and ask the human to confirm it. A resolved annotation does not mean the model passed. Honor cancellation/timeouts; never retry automatically.
