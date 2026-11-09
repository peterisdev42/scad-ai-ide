# Agent integration verification

The [capability matrix](agent-capability-matrix.md) describes shared services, permissions and GUI boundaries. The generated [catalog](agent-capability-catalog.md) lists all 40 tools. Verification has three distinct levels: service contracts, real VS Code registration/GUI behavior, and actual model-driven workflows. Success at one level does not establish the next.

## Automated checks

```sh
npm run check:agents
npm run check-types
npm run lint
npm test
npm run test:capabilities
npm run test:customizer
npm run test:libraries:ui
npm run test:libraries:integration
npm run test:integration
npm run package
```

- `check:agents` checks catalog, manifest schemas, registrations, GUI classifications, generated resources, two Instructions and five Skills.
- Capability suites cover all handler bindings, explicit identities, atomic validation, stale targets, trust/path guards, cancellation, redaction, Development-only access and service-side confirmations.
- Browser tests cover Customizer, Runtime, Libraries, More and AI Panel. Host tests check actual `vscode.lm.tools` and `vscode.lm.invokeTool`, shared state and CLI arguments without requiring panels.
- Installed Production smoke must reject Development cache access even when directly invoked. VSIX inspection checks shipped runtime assets, Instruction and Skills.

```sh
npm run verify:agents:vsix -- /absolute/path/to/extension.vsix
npm run test:agents:installed -- /absolute/path/to/extension.vsix
```

Host runs can use `SCAD_VSCODE_EXECUTABLE` to select an installed VS Code. The existing Markdown native-preview case also requires `SCAD_PREVIEW_EXPORTER`; LSP cases require a runnable platform-specific server. Library/Preview real CLI cases may require `SCAD_OPENSCAD_EXECUTABLE`. Missing prerequisites and skipped tests must be reported separately. See [development setup](../CONTRIBUTING.md).

The last recorded macOS arm64 verification on 2026-11-06 passed 266 unit tests (three environment-dependent cases skipped), 24 Customizer browser cases, six module UI cases, the AI Panel browser check, and all 25 Extension Host cases on both VS Code 1.140.0 and 1.145.0. Installed VSIX discovery and Production Development-only rejection also passed. These are previous run results, not a guarantee for another checkout or platform; rerun the commands for the change under review.

## Real model verification

Use an explicit test workspace and a tool-calling model provider in ordinary Agent mode. [Ollama setup](ollama-development.md) describes the tested local-provider path. Inspect the available SCAD tools and bundled Instruction/Skills before sending prompts; tool discovery alone is insufficient. The picker uses reference names `scad_*`, while registered API names are `scad_ai_ide_*`.

| Workflow                                                                     | Required observations                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime: “查看当前 OpenSCAD Runtime，并安装/切换到最新可用的稳定版本。”      | Real catalog ID, installation terminal result, selected active ID, GUI/status/Preview update; explicit cancellation/offline errors; unmanaged removal rejected.                                                                                                                |
| Customizer: “列出当前模型 Customizer 参数，把尺寸改为合法值并验证。”         | Latest target/revision, JSON values with the correct types, GUI/Preview overrides and unchanged SCAD source. Invalid multi-value writes remain atomic; document switches reject stale writes. Exercise preset create/save/reset/apply/import/export/delete and external edits. |
| Libraries: “在当前项目安装指定 OpenSCAD Library 版本并检查 lockfile。”       | Explicit workspace project, observed exact version, manifest/lock/mount agreement. Verify uses the library version key returned by `libraries.globalState`. Restore respects the lock. Cleanup planning does not delete; cancellation/stale plans preserve resources.          |
| More/Dev: “检查 GitHub 连接状态；在开发模式检查缓存，但不要泄露任何敏感值。” | Safe auth status without credentials; actual authorization UI when requested. Production rejects Dev data access. Development inspection is bounded/redacted; scoped clearing requires real confirmation and reports partial failures.                                         |

Check actual tool **Input/Output**, Dispatcher terminal state and postconditions. A model's final text, a completed tool bubble or a returned `LanguageModelToolResult` is not proof of business success: service errors are currently encoded as JSON `ok: false`. Logs contain only capability ID, operation ID and terminal status, without input payloads or cache values.

## Known acceptance gaps

The 2026-11-06 test used VS Code 1.145.1, official `Ollama.ollama` 0.0.14 and local Ollama 0.40.15. `mimo-v2.6:latest` completed automatic four-module read-only selection and installed `bosl2@v2.0.781`. Independent checks confirmed manifest version, lock commit `9eb555a08f38cabb8a6c9761d18ec7517c36321c`, a valid project symlink and `std.scad` in the test profile. Overall, 31 dispatched calls covered 14 capability IDs: 24 succeeded and seven failed.

- Numeric Customizer calls supplied strings such as `"20"` instead of numbers. The service correctly returned `INVALID_VALUE`, preserving all values. Explicit numeric guidance did not resolve it. The source of conversion across model, Ollama template and provider is not yet isolated; this does not establish a service defect or prove the service defect-free.
- One preset reset returned `STALE_STATE`; rereading state and retrying succeeded. Preset create/reset/apply succeeded, but the target numeric values and full preset lifecycle were not accepted.
- Library verify twice used a Development registry-cache ID instead of a library version key and was rejected. Exact installation passed; the full verify/restore workflow remains unaccepted.
- Despite a metadata-only request, the model proposed cache inspection. The tester skipped the real confirmation, so inspection and clearing were not executed.
- Some requests stalled before issuing tools or before a final reply. Short/fresh sessions and thinking-setting trials did not complete Runtime installation/selection. A supplementary direct Ollama API request timed out after 30 seconds; it executed no capability and is not Agent acceptance.
- `qwen3.5:0.8b-mlx` read state, attempted native file editing despite the prompt, then claimed success after failed calls. Final disk checks confirmed the original SCAD fixture and dependency manifest remained intact.

Repeat incomplete cases as short tasks and compare raw provider tool calls, API inputs and actual state when diagnosing failures. Keep strict types, target/revision checks, trust/path guards and independent confirmations. Do not coerce invalid values or relax authorization to make a model test pass. Parameter descriptions and business-error presentation can affect model reliability and warrant validation alongside model/provider behavior.

Actual Skill triggering and Instruction application across harnesses, authenticated GitHub authorization, Runtime install/select GUI/Preview parity, full preset lifecycle, library verify/restore, and Dev inspect/clear still require the respective real workflow evidence. Prior mocked/platform tests do not replace these cases.

## Host and platform boundaries

The extension uses stable APIs with engine `^1.140.0`; it contributes no MCP server or custom agent. Another harness, CLI or cloud client may not consume editor extension tools or contribution resources. Record VS Code version, harness, provider, model and execution host for each run; do not infer one from another.

SSH/WSL/Dev Container and native Windows/Linux installation behavior need actual authorized environments. Verify that Runtime executable paths, project paths, library store and subprocess environment belong to the remote extension host. A local macOS run or path mock cannot establish remote/platform acceptance. More's GitHub connection serves GitHub API access and does not configure the Chat model provider.


## Customizer source authoring verification (2026-11-06)

Source-specific implementation and evidence are tracked in [Customizer source authoring](customizer-source-authoring.md). Run `npm run test:customizer:source` for shared scanning, ranges, widgets, negative fixtures, planning/idempotence and expectations. `test:capabilities` additionally covers source schema rejection, unsaved buffers, version/hash CAS, expiry, single use, trust loss, cancellation, canonical paths/symlink escapes, WorkspaceEdit refusal, postcondition failures and Quick Fixes.

The actual Host case `source tools edit unsaved buffers with CAS and refresh GUI schema, diagnostics and Quick Fixes` requires a trusted test folder: set `SCAD_TEST_WORKSPACE` to an isolated workspace directory when running `test:integration`. Without a workspace it explicitly skips. It checks real TextDocuments/WorkspaceEdits, disk preservation, Customizer state, DiagnosticCollection and the code-action provider. The installed smoke independently verifies contributions and Production restrictions. Neither is a model-authored workflow.

Real model acceptance for the NEW source tools is still required. Prior Ollama results above concern runtime Overrides and libraries, not source authoring. Do not use those results to mark source E2E-01 through E2E-09 accepted. Likewise, Linux, Windows and Remote SSH/WSL/container execution is not established by a macOS run. Optional agent Hooks are deferred and no hook execution/configuration is installed.


Final local source-authoring run: 288 `npm test` passes and three existing environment-dependent skips; 16 source tests and 21 capability/service tests passed; 24 Customizer browser checks and the AI Panel check passed. Full Extension Host runs passed all 26 tests on both VS Code 1.140.0 and 1.145.1 using clean profiles and the real 2026.11-RC0 Preview Exporter. VSIX resources and the installed Production analyze/plan/commit/validate path passed. For clean reproducibility use `SCAD_TEST_USER_DATA` in addition to `SCAD_TEST_WORKSPACE`; an older persisted test profile caused a keyboard timeout that did not reproduce in either clean full run. Raw evidence remains in `.build/customizer-source-*.log`. New real-model and non-macOS source-authoring acceptance remains pending.


Runtime read contract follow-up: `runtime.state` now returns a complete `state.activeRuntime` independently of installed-list pagination, explicit `hasMore/nextOffset`, and bounded discovery status/diagnostics/configured-path errors. Runtime, capability and service suites passed 74 cases; five targeted actual Host cases passed on VS Code 1.145.1, including a real CLI version probe through `vscode.lm.invokeTool`, canonical executable path comparison and an invalid configured-path result. Evidence: `.build/runtime-agent-unit.log`, `.build/runtime-agent-host.log`. Resource/type/lint/build/VSIX checks passed. This proves registration and execution, not native-model tool choice.

An additional isolated native Agent + official Ollama attempt selected `mimo-v2.6:latest` but showed a Copilot sign-in dialog and produced zero Runtime calls. This attempt is **not accepted** as a model workflow; raw result and UI evidence are retained in `.build/runtime-native-first-evidence.json` and `.build/runtime-native-chat.yml`. No account authorization was performed. The user's running native-model/provider/tool-selection configuration still needs matching before attributing their missing Runtime response to a specific cause.

The native Configure Tools UI also displayed the SCAD AI IDE group in a local-model session. The screenshot/snapshot in `.build/runtime-native-tools-expanded.yml` is virtualized and does not establish all child tool entries or actual model invocation; it must not be used as a substitute for the recorded zero-call result. Tool naming now explicitly includes Runtime, current CLI and installed versions to improve discovery. The actual user's native model/provider remains unspecified at the end of this local investigation.


## Four management-panel business parity (2026-11-06)

The user confirmed the current scope as Runtime, Customizer, Libraries and More; Preview rendering/measurement/scene editing/export/slicer integration is deferred. The generated [GUI/Agent contract table](gui-agent-parity.md) covers 11 audited GUI groups and 41 business actions, including valid tool inputs for each operation. Generation/checks validate all examples against strict catalog schemas; the critical online/installed refresh and cancellation tests execute inputs directly from that table. CONTRIBUTING and bundled Instructions require shared-service Agent coverage whenever a GUI business action changes.

New behavioral coverage includes GUI-origin Runtime/Library cancellation via shared abort controllers, registry installability/cache parity, redacted GitHub diagnostics, shared Library progress, pagination and Runtime install/remove postconditions. The Runtime lifecycle test downloads a fixture archive through an injected transport, verifies checksum, extracts to a real temporary managed directory, probes the executable's version, switches to it, refuses deletion when consent is denied, then confirms deletion and checks both disk and inventory. Catalog transport is deterministic; this is not a public-release download or a model-driven acceptance test.

Local results: 292 passing default tests, three pre-existing environment-dependent skips; 24 capability/service tests; 24 Customizer, six Library and one AI Panel browser checks; all 26 actual VS Code 1.145.1 Host cases passed in a clean profile. Type/lint/manifest/package checks passed, including the new GUI contract guard. Evidence: `.build/gui-parity-full.log`, `.build/gui-parity-capabilities.log`, `.build/gui-parity-*-ui.log`, `.build/gui-parity-host.log` and `.build/gui-parity-package.log`. The minimum supported VS Code 1.140.0 also passed all 26 full Host cases (`.build/gui-parity-host-min.log`). Final VSIX resource inspection and isolated installed Production smoke passed (`.build/gui-parity-vsix.log`, `.build/gui-parity-installed.log`), including all 40 tools/resources and the real source plan/commit/validate path. Linux/Windows CI execution and actual native-model automatic selection/invocation remain separately unaccepted; earlier direct Host or fixture-based successes must not be described as those tests.


## Customizer diagnostic policy follow-up (2026-11-09)

The explicit policy now supersedes earlier basic-usage diagnostics: missing Widget hints/groups/descriptions, reassignment, expression defaults, Hidden/Global usage, unsupported forms, unlisted dropdown defaults and off-step defaults produce no source diagnostics. The obsolete DUPLICATE_ASSIGNMENT/UNSUPPORTED_DEFAULT/DEFAULT_OFF_STEP information and warning rules are removed. Concrete malformed written hints or inconsistent written range/length constraints receive warnings with visible repair instructions. Tests repair each warning or remove the annotation and assert it disappears. Optional group/hint additions are Refactor actions. Explicit goal mismatches return bounded `expectationResults`/`semanticPass` rather than error diagnostics.

Local unit, type, lint and generated-manifest checks passed. Default test totals: 299 passed and three existing environment-dependent skips. Source suites: 23 passed. Actual VS Code 1.140.0 Host: 26/26 passed, including automatic Problems cleanup and no usage diagnostics after the debounce. VS Code 1.145.1 Host: the Customizer case and 24 other cases passed; the existing native-keyboard case timed out once and passed in a separate isolated retry. It is not recorded as a clean 26/26 single run. The prior 2026-11-06 Host attempt was never executed because automatic approval review had exhausted its quota; this run obtained actual execution permission.

Evidence: `.build/customizer-policy-source.log`, `.build/customizer-policy-unit.log`, `.build/customizer-policy-host.log`, `.build/customizer-policy-host-min.log`, `.build/customizer-policy-keyboard-retry.log`. This remains deterministic/Host evidence; it does not establish a real-model authoring workflow.


Final policy VSIX `.build/scad-ai-ide-customizer-diagnostics.vsix` passed resource inspection and installed Production smoke. The installed `sourceValidate` call against an unannotated number with an explicit Slider target returned ok=true, semanticPass=false, diagnostics=[] and expectationResults[0].matched=false; the subsequent source plan/commit/validate success path also passed. Evidence: `.build/customizer-policy-vsix.log` and `.build/customizer-policy-installed.log`. This confirms the packaged code uses the new policy, not just its tool description.


Trailing-comment regression (2026-11-09): `assembly_id=0; // [0:22] IDs in Assembly.md; 0 shows the selected group` no longer reports a missing closing bracket. The scanner detects unquoted closing brackets rather than requiring the whole comment to end in one. Whole-comment Widget parsing is unchanged: put the description on the preceding line and leave only `// [0:22]` inline to obtain a Slider. Structured Widget edits refuse to erase trailing explanations. LF/CRLF, quoted brackets, genuinely unclosed hints and source preservation have regression coverage. Source tests: 25 passed; default tests: 301 passed, three existing environment skips; type/lint/package checks passed. The targeted VS Code Host source-tools case passed, including warning removal after replacing an unclosed hint with the exact closed comment. Evidence: `.build/customizer-trailing-comment-{source,unit,package,host}.log`.
