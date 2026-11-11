> 2026-11-11 更新：源码诊断已改为独立文档服务，视图关闭不再清除源码错误，并新增强制 Text 定位操作。当前行为及验收以[生命周期与导航修复](problems-lifecycle-navigation.md)为准；下文保留初版历史。

# Preview failures in Problems

2026-11-10. User-authorized follow-up; no model test was started and the cleared architecture goal was not resumed.

Preview failures now publish to VS Code's DiagnosticCollection with source `OpenSCAD Preview`. This is the same diagnostics API exposed to Problems readers; no new Agent tool or model invocation is required. The actual Host test reads `vscode.languages.getDiagnostics`, rather than claiming that a real model read the error.

- `PREVIEW_RENDER_FAILED` / Error: parser, evaluator, CLI crash, exporter or runtime failures delivered by the Preview session. Explicit file/line information is used when present; otherwise the diagnostic attaches to the document start. A warning's location is never borrowed to fabricate the location of an unrelated error. Included-file errors retain their own URI and link back to the previewed source.
- `PREVIEW_VIEW_FAILED` / Error: graphics initialization/recovery, stage rendering, mesh/scene decoding, and global uncaught Webview failures. Model-bound reports carry their modelVersion; the Host rejects obsolete model errors. Startup/global errors without a model version remain reportable.
- `PREVIEW_EMPTY_MODEL` / Information: a configuration-only or genuinely empty model remains distinguishable from a source/render error.

Each view owns an independent collection. Render diagnostics clear when a new request starts or compilation succeeds; graphics diagnostics clear on a valid current frame. One view cannot clear another view's diagnostics. Disposal clears the view's included-file and source diagnostics; late reports are ignored. Intentional cancellation is not reported as a new error. Existing webview messages, Output and notifications are retained.

OpenSCAD stderr capture now keeps bounded head/tail context and the first 20 distinct error lines, including errors between large warning floods and chunk boundaries. Forwarded stderr is limited to 128 Ki UTF-16 units with a truncation marker. `ERROR:` output is treated as failure even when the CLI returns zero. This limit applies to stderr, not all stdout or all exporters' existing limits. It does not change render timeouts or automatically repair source.

## The reported rpi.scad failure

Real OpenSCAD 2026.11.06 / a81e8630 was invoked read-only on the user's disk file. It generated repeated undefined operations at line 73, `ERROR: Stack exhausted while trying to convert a vector to EchoString`, and exited 139. Its stderr was 190,612,900 bytes. The duplicate `module cube(l,w,h)` shadows the built-in cube and recursively calls itself with a vector; parameter coverage warnings are separate from this runtime failure. The user's source was not edited. The native error log is preserved locally in /tmp; its hash, size, first lines and distinct errors are indexed below, rather than committing 190 MB of repeated output.

## Executed verification

| Check | Result |
|---|---|
| Build, types, lint, catalog | PASS (`npm run compile`); final test additions also compiled |
| `npm test` | core 219 PASS; Preview 102 PASS; Library 26 PASS / 3 conditional SKIP |
| Final Preview regression after adding the fast-mode early-return/dispose case | 103 PASS; final strengthened CLI zero-exit/error-with-valid-output case also passed (CLI suite 5 PASS) |
| Actual Chromium Preview browser suite | 18 PASS; includes stage failure→Host error message and malformed mesh→versioned Host error message, as well as normal rendering/recovery |
| VS Code 1.140 actual diagnostics API | PASS: severity, source locations, included-file ownership, cancellation, independent views, recovery and dispose |
| Native OpenSCAD→actual ScadSession→ScadWebviewPanel→Problems | PASS in the isolated Host, using a temporary syntax error; unsaved repair produced a real model and cleared the render error, original disk source unchanged. Combined Host run: 2 PASS |
| Initial failed checks | Retained: sandbox CLI CPU-feature failure; generated test CLI had an extra parenthesis, repaired before successful regression; new native Host fixture initially had an invalid Memento test cast, corrected before compilation/execution |
| NOT RUN | Real model reading Problems; new VSIX packaging/installation; complete Host suite; Windows/Linux/Remote testing of this change; exhaustive fatal Webview startup/device failure injection |

The native Host pipeline case skips explicitly if `SCAD_TEST_OPENSCAD` is absent. It was provided and executed in the recorded run, so that run had no skipped Host case. Browser tests use a controlled Host-message bridge; API and actual native compiler integration are verified separately in the Host. They are not represented as one fully installed end-to-end browser/model test.

[Evidence](evidence/problems-2026-11-10/). The previously delivered VSIX does not include this source change; installation must be updated before the running installed extension can show the new diagnostics.
