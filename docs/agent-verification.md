# Agent integration verification

The [capability matrix](agent-capability-matrix.md) describes shared services, permissions and GUI boundaries. The generated [catalog](agent-capability-catalog.md) lists all 37 tools. Verification has three distinct levels: service contracts, real VS Code registration/GUI behavior, and actual model-driven workflows. Success at one level does not establish the next.

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

- `check:agents` checks catalog, manifest schemas, registrations, GUI classifications, generated resources, one Instruction and four Skills.
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
