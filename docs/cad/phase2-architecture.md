# Phase 2 architecture and delivery ledger

Baseline: `3e3628a12eeb64699815224a6a96221e1aa49c62` (P1 branch tip). Local `main` and the last fetched `origin/main` were `8a3ff1fe394b11aeb7fb323e7319bd365d29abaa` at implementation start. Work is isolated on `codex/cad-mesh-measurements`; Phase 2 depends on PR #2. No change to main, merge or publication is authorized.

## P2A: evidence lifecycle

The v2 mesh snapshot separates source state from exported mesh content. Its source state includes input content, candidate dependency fingerprints, runtime and library environment via the existing v1 source snapshot, effective Customizer overrides, explicitly requested global tessellation, units and analysis policy. The final snapshot adds the SHA256 of frozen raw bytes. v1 diagnostics remains a separate compatible contract. `resources/schemas/cad-report-v2.schema.json` defines the added report.

`MeshVerificationService` owns immutable reports and shared tasks. Host adapters inject capture/export, Worker and content storage. Reports do not depend on Preview. Historical reads never rerender. Every current result is recaptured before publication; invalidation generations reject input changes even when content is restored during a task. Geometry and PNG completion are independent.

`ArtifactStore` writes private session directories inside a workspace-hash namespace. It uses SHA256, atomic replacement, LRU/TTL capacity limits and active-operation leases. Reports and artifacts are bounded and session-local; restarting the extension expires report IDs. Corrupt or missing artifacts cause explicit errors. `OperationQueue` bounds admission separately from the shared official CLI queue. No source writes or automatic full renders on edits/save are added.

## P2B: raw geometry seam

The disposable `mesh-verification-worker.mjs` decodes STL/3MF before any conversion or repair. It is separate from Preview's existing Manifold worker. Exact coordinate equality is the sole topology weld rule. Original triangle IDs and 3MF object-instance origins survive normalization. Memory limits describe V8 heap and explicit array budgets, not an OS RSS limit.

3MF uses package StartPart relationships, bounded ZIP/XML parsing, Core transforms and units, reversing triangle orientation for reflection. The Core format reference is [3MF Core](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md). Unknown required extensions and normalization uncertainty cannot produce PASS. This is a supported Core geometry reader, not a full OPC/XSD conformance validator.

## P2C: proof limits

Exact predicates come from [robust-predicates](https://github.com/mourner/robust-predicates); fixed tests lock the library's signs. BVH limits candidate pairs. Ambiguous near-contact, shell relations or stopped budgets are UNRESOLVED. Stable translated compensated sums provide mesh measurements with roundoff estimates, not analytic surface error bounds. Physical volume requires all solid prerequisites. Multi-shell instance unions with overlapping bounding boxes remain conservatively UNRESOLVED unless a later implementation proves their complete material-region composition.

## P2D: presentation and compatibility

The catalog extends analyze with verify and adds measure/renderViews. Tools use the same coordinator and operation tracker as v1. Raw binary issues navigate to reports instead of invented source lines. Inline delivery is explicit and uses native image parts, within 4 MiB; JSON contains metadata only.

PNG uses official CLI to import a frozen display STL derived from the audited world-space mesh. This Float32 display conversion is independent of Float64 raw measurements; both content hashes and maximum coordinate quantization error are reported. It applies no topology repair. Original 3MF remains the raw evidence. Image unavailability never grants or removes geometry PASS.

## Acceptance policy

The functional, real Native Agent and cross-platform release gates are recorded separately in `phase2-acceptance.md`. Until evidence is recorded, all are NOT_RUN. P1 follow-ups in `../cad-gate-p1-followup.md` and the Windows Unicode KNOWN_PLATFORM_GAP remain open. Native Agent scenarios have one bounded attempt (240 seconds); no retry or inferred PASS. Unsupported, failed and unavailable environments are recorded explicitly.
