# Phase 4: frozen evidence review

Baseline: `12c106372be287f50775320bb79c97e1077f337c` (Phase 3 PR #4, unmerged). Development branch: `codex/cad-diff-feedback`. No main changes, merge or release are authorized by this delivery.

The review domain consumes existing v2/v3 reports and frozen mesh bytes. Summary comparison, build-envelope screening, feedback and retained baselines remain separate from model verification. A comparison has its own completeness/regression status and explicitly carries both model statuses. Removing or modifying a required constraint never proves repair. Stable identities are author part IDs scoped to the canonical Manifest URI; a standalone document is one whole subject. Triangle multiset digests preserve orientation and container fill semantics; anchor identity is stricter and includes the exact raw-byte hash.

`ReviewEvidenceStore` stores explicit baselines and user feedback outside the transient artifact cache. It uses a project-specific private directory, content-addressed mesh blobs, atomic index replacement, an interprocess lock, optimistic feedback revisions and expiring host leases. User data has no TTL and is not silently evicted. Quota failures preserve existing records. Retained bundles omit source text, CLI logs and PNG by default. Reads never implicitly compile source. Corrupt or unsupported indexes are rejected without migration or reinterpretation.

A separate Node Worker decodes original geometry, generates display evidence, checks host-side Float64 picks and computes numerical print candidates. It shares the geometry admission queue and its cancellation/budget policy. The existing Stage renders a read-only frozen evidence view; display rebasing and Float32 error are explicit. Source Preview remains live and only provides a link to existing evidence. No per-frame geometry analysis is added.

Pointing requires an actual graphical request and explicit human submission; tool JSON cannot supply coordinates or acceptance. The host validates report/snapshot, request identity, view nonce/generation, source freshness and the original finite nondegenerate triangle. A failing solid may still have a valid surface anchor. Stale feedback is monotone; exact raw local geometry and a rigid v3 pose may yield a candidate, but only a new explicit human confirmation accepts it. Resolving an annotation never sets model PASS.

Printing is opt-in through a local millimeter FDM profile. It screens one subject's local mesh under the print pose, independently of assembly placement. Envelope results use outward intervals; triangle-angle results are numerical overhang candidates. The result always states `printability: NOT_CHECKED`. Wall thickness, bridges, supports, slicing and manufacturing success remain outside scope.

New interfaces: `model_compare`, `model_getFeedback`, `model_requestPointing`, `model_checkPrintability`, `model_manageReview`. Original 46 tools retain their contracts. New skills cover design review, human spatial feedback and explicit print screening. No Phase 5 MCP or assembly identity expansion is included.

Acceptance records distinguish automated functionality, true Native Agent/human interaction, installed-product checks and cross-platform release. Earlier open gates and Windows Unicode gaps are not inherited as passes. Each real Agent scenario is limited to one 240-second attempt.

Feedback remap history retains the original anchor, including camera origin, pose and provenance. A confirmed remap clears unavailable current-camera evidence instead of reusing an old view. Tool projections enforce the 32 KiB budget and may omit explicitly flagged deep evidence while preserving committed record identities.
