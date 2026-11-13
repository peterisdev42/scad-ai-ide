# Raw mesh verification and measurement (Phase 2)

Use **SCAD AI IDE: Verify Raw CAD Mesh**, **Measure CAD Mesh** or **Render Frozen CAD Mesh Views** on a workspace SCAD, CSG, STL or 3MF document. Analysis is explicit. Root SCAD/CSG buffers are evaluated without saving; standalone mesh inputs use disk bytes and report dirty text buffers as `DIRTY_MESH_BUFFER_NOT_EVALUATED`. Workspace Trust is required throughout.

Standalone STL/3MF verification works without OpenSCAD. SCAD Full Render and PNG need the selected official Runtime. Preview does not need to be open. PNG environment availability is separate from geometry validity.

Agent examples:

```json
{"uri":"file:///workspace/model.scad","mode":"verify"}
```

Call `scad_ai_ide_model_analyze` with the above input. `mode="diagnostics"` retains its original CSG-only v1 behavior. The verify mode returns a v2 summary, a report URI, checks, issue IDs and frozen artifact references. Optional `units="mm"` declares units for SCAD/STL; otherwise they remain `modelUnits`. Standalone 3MF honors its metadata units and converts to mm.

```json
{"reportId":"cad-<report UUID>","measurementTypes":["bounds","surfaceArea","signedVolume","physicalVolume"],"objectOffset":0,"objectLimit":20}
```

Call `scad_ai_ide_model_measure` by reportId to read existing evidence, or supply exactly one URI to explicitly verify first. Object measurements are paginated. Bounds describe referenced mesh geometry; unused source vertices remain in raw counts and provenance. Measurements describe the decoded/exported mesh, not analytic curves. Error estimates describe floating-point roundoff, not a certified analytic surface approximation.

Physical volume requires closure, manifold topology, no self-intersection, proven shell/material relations and correct winding. An inward closed STL retains negative signed volume and has no trusted physical volume. A valid CSG subtraction is interpreted from its final exported surface. Raw topology is never repaired or epsilon-welded. 3MF overlapping instances and unproven multi-shell composition return UNRESOLVED aggregate volume while keeping per-instance facts.

```json
{"reportId":"cad-<report UUID>","cameras":["iso","front","top"],"imageSize":[512,512],"delivery":"metadata"}
```

Call `scad_ai_ide_model_renderViews` for official CLI PNG from the same frozen mesh. Up to four views are allowed (also `right` or an explicit eye/target camera), at most 1024×1024 each. Default metadata includes camera/framing, units from the report, raw mesh hash, rendered mesh hash and Runtime identity. Readonly PNG URIs use `scad-cad-artifact:`. For 3MF, display STL is derived from the original transformed mesh; Float32 display quantization is recorded separately from original Float64 facts.

Request `delivery="inline"` explicitly for native VS Code image parts. Unsupported APIs, missing artifacts or a cumulative payload above 4 MiB fall back to metadata; image bytes are never base64 JSON. No Provider vision capability is inferred. Images do not grant visual review PASS.

Call `scad_ai_ide_model_getIssue` with reportId, issueId and optional includeEvidence. Geometry evidence contains bounded triangle IDs and representative world-space vertex coordinates, component facts and bounds, with cursor/limit pagination. Binary mesh Problems use model-level locations and report navigation. CLI and geometry projections share the existing source Problems coordinator; LSP diagnostics remain independent.

Read execution status separately from overall check status. `ok:true` means a report was returned. Required checks aggregate FAIL → UNRESOLVED → SKIPPED → PASS. Empty geometry is SKIPPED unless requireNonEmpty=true. Unsupported formats/extensions, dirty dependencies, ambiguous contacts, stopped budgets and Worker failures cannot produce PASS. Missing/expired report IDs or artifacts are explicit errors and never trigger implicit compilation. Historical reports remain readable with current=false.

Default limits: CLI/Worker concurrency one each; CLI timeout 120 seconds, Worker 60 seconds; pending work 32; raw bytes 128 MiB, decompressed ZIP 256 MiB; one million unique topology vertices and 500,000 triangles; five million candidate tests; V8 Worker heap 512 MiB and explicit array budget 256 MiB (not an OS RSS limit); artifacts 512 MiB/128 source snapshots/30 minutes. Sessions are workspace-isolated. Reports expire on restart; active operations lease artifacts against eviction.

Assembly identities, clearance constraints, geometry diff, spatial picking, thickness and printability are outside Phase 2. Read the [actual acceptance ledger](cad/phase2-acceptance.md), [architecture](cad/phase2-architecture.md) and unchanged [P1 follow-ups](cad-gate-p1-followup.md) before treating any gate as complete.
