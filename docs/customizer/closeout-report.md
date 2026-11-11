# Customizer Closeout 验收结果（2026-11-11）

本轮验收已收口，**完整 SPEC 未全通过**。用户要求对反复无法完成的问题记录并跳过；本轮据此暂缓 Windows 原生 Unicode 修复、表达式场景的模型调优，以及模型回答中尚不准确的部分。没有合并 main、发布 Marketplace/Release 或修改相邻仓库。

- **Customizer Feature Completion：PARTIAL。** 核心回归、固定上游差分、当前 VSIX 安装/Sidebar、两次实际 Author 和真实取消场景已有本轮证据；模型表达式超时、部分回答准确性及少量实际环境边界仍未过。
- **SCAD AI IDE Cross-Platform Release Readiness：FAIL。** 两轮 Windows 原生 Library workflow 都失败；不能宣布全平台发布已验收。

## 版本和候选包

起始远程 main 和最终复查 main 均为 `53ec2e41a565a19ef795b8dbc7ba8b42d9b9cf70`。初始 clean HEAD 是 `39a90a364c24baa36b6fb30fc3d8cc18a2d70384`，包含一笔此前已有的 Preview Problems 导航修复。本轮在 `codex/customizer-closeout-20261111` 独立分支继续，不回滚这笔修复。

本机 Production 候选：[scad-ai-ide-closeout-d1a5fde.vsix](../../.build/scad-ai-ide-closeout-d1a5fde.vsix)，**4,604,838 bytes**，SHA256 `5d1c3523ac43b8cf93c04f344b13b086486bc7b026599adfef1689685bd28c2a`。

- 构建源码：`d1a5fdedc7f9c4b61a6cf65b0899ed748d1642df`。
- 本轮 CI：`f81ed00ac63854cdfa69d7d5d90175601abc2be1`。
- 后续 Native 驱动修订精确提交见 [机器台账](closeout-evidence.json)。后续改动只有验收驱动、证据和文档；相对构建提交的 `src/`、manifest、lockfile、Skills、Instructions、media/resources 和打包配置没有变化。**这些 SHA 没有被冒称为同一个提交。**
- 40 Tools 的完整 schema 与生产 manifest 一致，2 Instructions、5 Skills 资源存在；[逐文件 hash 对照](evidence/closeout-20261111/package-content-binding.json)。所有本轮模型使用同一 VSIX SHA 与同一 installed bundle digest。
- 通过官方 prepublish（含 LSP build）串行打包，之后没有 build/watch 覆盖 dist。最低 VS Code **1.140.0** 的隔离安装 smoke 和真实 Sidebar 都通过。本包包含本机 darwin-arm64 LSP，不代表 Windows 安装/GUI 已通过。

## 本轮已完成与修正

唯一产品语义修改是 [ADR13](../customizer-architecture-adr.md)：固定上游 `CommentParser::getLineToStop` 会把字符串中的 `{` 也作为 Customizer 按行截止点。IDE 原先会错误保留控件；现在复用既有单一扫描器的截止函数，不改变 SCAD 作用域、不改源文件或放宽安全门。保留原字符串 brace 案例，同时维持全部普通控件 fixture 的覆盖。ADR12 的跨行覆盖 Warning 保持。

| 实际执行 | 本轮结果 |
|---|---|
| npm ci；agents/types/lint/architecture | PASS；首次 npm 只读缓存失败保留，改用临时缓存后成功 |
| 核心 npm test | **221 PASS** |
| 实际 Library（本机 CLI + Exporter） | **28 PASS / 1 SKIP**，在线 Registry 场景未启用 |
| Preview | **107 PASS** |
| Chromium Customizer | **42 PASS** |
| 最低 VS Code Host | **37 PASS / 2 pending**；补齐 native CLI 后单独执行原 pending 两项，**2 PASS** |
| 同一生产包安装 | Source Analyze/Plan/Commit/Validate、one-shot、真实 Undo/Redo、Preset、ADR12 Warning/related positions/清除 PASS |
| 同一生产包真实 Sidebar | 全部控件丢失解释、实际点击导航到覆盖赋值、unsaved 修复清理、部分控件保留 PASS |
| 精确 pinned Linux CLI | 原有41 + 新增1 = **42 schema MATCH**、**10 import PASS**、**14 ADR12 差分 PASS** |
| Host 生命周期 | 6轮、每轮32文档；5个被测类 dispose 后保留实例增量均0；不宣称 renderer/GPU 无泄漏 |
| 100KiB / 30样本 | Node Analyzer p50 **1.112ms** / p95 **1.423ms**；仅本机，不设跨平台阈值 |

固定上游：`bcf45a22caa954ca56ca287994cb6dbc368c67b2`，实编译 Linux CLI SHA256 `29bc3b4779b0471388a11536b47b7d4533f26b94f0fc52e1beec49564199717f`；下载后重新计算二进制 hash 并与 build-info 对上。[运行及验证](evidence/closeout-20261111/pinned-current/artifact-verification.json)。没有把 headless CLI 当 Qt GUI。

CI：[Agent 三平台/Panel 全绿](https://github.com/peterisdev42/scad-ai-ide/actions/runs/43001611742)、[Pinned 全绿](https://github.com/peterisdev42/scad-ai-ide/actions/runs/43001611738)、[Library 第一轮](https://github.com/peterisdev42/scad-ai-ide/actions/runs/43001611736)、[Library 第二轮](https://github.com/peterisdev42/scad-ai-ide/actions/runs/43002292201)。两轮 Library 的 macOS/Linux 都成功，Windows 都失败。各 job 与 source SHA 保留在机器记录中。

## oMLX 指定模型：实际结果与局限

实际链路为安装版 SCAD AI IDE + VS Code Native Chat Agent + 未修改的 `techopolis.omlx-copilot-chat` 0.1.2 + oMLX 0.7.3 + `Qwen3.6-35B-A3B-OptiQ-4bit`。不是手工 invokeTool，也不是用直连 API 成功冒充 Native。

Mac 为 Apple M4 Pro / 48GiB / macOS27.0。API/Provider 都宣告262144上下文；模型权重 digest/revision、精确采样参数和 KV 配置仍未知。Provider 默认只转发前16工具，本轮通过 Native 的工具选择限定 Source 工作流；透明本机 HTTP 观察器实录请求中的三个 Source schema，实际请求共4–5工具。没有改成无限工具数，没有改 Provider 或截改模型回复。Preset只读场景另加 state 工具。

| 场景 | 结果与独立复核 |
|---|---|
| MODEL00 / dirty-buffer smoke | PASS；真实 Analyze/Validate，分析 hash 来自未保存 buffer，磁盘不同且不变 |
| MODEL01 Author | **PASS 2/2**；两次独立新工作区，均实际 Analyze→Plan→Commit→Validate，三个目标 matched，最终 buffer 再独立解析，几何/defaults 原样、dirty=true、磁盘 hash 不变 |
| MODEL02 尾注 | PASS；一次 NEEDS_MANUAL_REVIEW 后停止，说明全文保留，不绕用 writer、不虚称修复 |
| MODEL03 表达式 | **FAIL / 后续调优 SKIP**；Analyze 成功，但240秒内未正常结束。实际 buffer/disk 没变；不能从安全保留推导完整任务通过 |
| MODEL04 负面结果 | PASS；实际 semanticPass=false 和缺失 URI 的 ok=false/OUTSIDE_WORKSPACE，最终答复如实 |
| MODEL05 用户取消 | PASS；实际确认界面 Skip 一次，没有 Commit dispatch、重新计划或备用 writer，模型停止，buffer/disk hash 原样 |
| MODEL06 恢复安全门 | deterministic Host PASS；生产安装包拒绝 replay，Host 源变更/CAS负例通过。不是额外一次 model-driven stale 会话 |
| MODEL07 Preset | PARTIAL；真实 state 显示 version99只读，源/JSON hash 不变；但模型说“可能截断”，IDE实际为拒绝，并无依据宣称运行时不可用 |
| MODEL08 ADR12解释 | PARTIAL；解释合法覆盖和可见性契约失败正确，没有删除赋值；引用原 fixture 行1/3，而不是 dirty-buffer 真实行2/4，部分措辞把可见性 Warning 称注解缺陷 |
| MODEL09 完成报告 | PARTIAL；两次Author、取消、尾注及负例的关键事实可核对；上述表达式、Preset/位置描述问题阻止整体通过 |

两次 Author 和取消的 UI 决定均来自用户在本聊天的明确审阅授权。控制器逐次检查真实 planId、三目标预览、默认值和几何 bytes 后才点击相应 Native 按钮；取消分支只 Skip，其他写入没有授权。它们的 [确认记录1](evidence/closeout-20261111/native-author-reviewed-1/manual-decisions.json)、[确认记录2](evidence/closeout-20261111/native-author-reviewed-2/manual-decisions.json)、[Skip记录](evidence/closeout-20261111/native-cancel/manual-decisions.json) 与独立 buffer/disk 复核分别保存。没有用 requiresReview 或模型返回值代替用户授权。

**无效测试保留**：初始 smoke/expression/failure/override 使用 VS Code 默认 `chat.saveBeforeSend=true`，宿主在发送前保存了合成 dirty buffer；因此这些运行不能证明不保存，标为 INVALID TEST。已在隔离 profile 设 `chat.saveBeforeSend=false` / `files.autoSave=off` 后重跑；未修改用户 profile。初次浏览器 Mach bootstrap、原生 Qt NEON 探测及安装版 Undo焦点失败也保留，随后按实际前置条件修正复验，没有靠加 sleep 冒充修复。

模型 fixture 使用 `--disable-workspace-trust` 创建明确的受信任隔离环境；没有因此声称真实 Trust UI/撤销流程通过。dispatcher 成功率与任务通过分别记录；host Schema 拒绝数无法完整观察时填 null，绝不填0。

## Windows 已定位边界，保留失败并跳过继续猜测

两轮真实 `windows-2025` 21个分层探针的结果、退出码和几何完全一致。ASCII direct include、Junction、copy、symlink、实际环境注入通过；**仅 Unicode 源路径的无 include cube 即崩溃**，仅 Unicode 输出路径也失败。不能归咎于 Junction，也不能靠 fallback-copy 修好。没有同上游 SHA 的第二种独立 Windows build，尚不能区分发布包/上游的更深责任。

[归因、最小复现和可交接 issue 草稿](windows-unicode-closeout.md)。原 Windows native gate 继续 FAIL；没有删除中文 fixture、使用 continue-on-error、改成 skip 或修改外部仓库。全 ASCII 路径仅为已测临时边界，不自动搬运用户工程。

## 36项验收台账

PASS 只覆盖该行注明的证据范围，PARTIAL/FAIL/INVALID TEST/NOT RUN 不混入通过数。完整机器记录为 [closeout-evidence.json](closeout-evidence.json)，原始文件及 hash 索引见 [manifest](evidence/closeout-20261111/manifest.json)。

| ID | 状态 | 实际结论 | 主要证据 |
|---|---|---|---|
| A-001 | PASS | Remote main checked at start/end, clean initial tree; candidate source and later harness-only commits are distinguished. | [记录](evidence/closeout-20261111/artifact.json) |
| A-002 | PASS | Single scanner retained; minimal native cutoff fix, architecture gate passes. | [记录](evidence/closeout-20261111/final-architecture.log) |
| A-003 | PASS | Exact pinned Linux CLI: original 41 plus new string-brace fixture 42/42, imports 10/10. | [记录](evidence/closeout-20261111/pinned-current/artifact-verification.json) |
| A-004 | PASS | Low-noise diagnostics and contract mismatch remain separate; unit and real minimum Host negatives pass. | [记录](evidence/closeout-20261111/final-regression-corrected.log) |
| A-005 | PASS | Deterministic source fixes, stale CAS and raw source preservation pass; real Host native Undo/Redo passes. | [记录](evidence/closeout-20261111/host-integration-configured.log) |
| A-006 | PASS | Real preset I/O and unknown-version bytes preservation; production invalid snapshot refusal. | [记录](evidence/closeout-20261111/host-integration-configured.log) |
| A-007 | PASS | A→B→Default, watcher state, dispose and concurrency assertions pass; all five measured classes release instances. | [记录](evidence/closeout-20261111/host-integration-configured.log) |
| A-008 | PASS | Continuation exact tool/input, rejection of extras and one-shot plans; production and actual model commits observed. | [记录](evidence/closeout-20261111/final-source.log) |
| A-009 | PARTIAL | Deterministic TTL/replay/CAS/trust policy negatives and actual Native Skip pass. Real trust-revocation UI transition is NOT RUN; model fixtures explicitly disable workspace-trust prompting, not evidence of Trust UI. | [记录](evidence/closeout-20261111/test-capabilities.log) |
| A-010 | PARTIAL | Chromium 42 tests, minimum Host focus/Undo and installed lost-control Sidebar pass. Not every theme/narrow-layout/widget combination has a new installed-GUI observation. | [记录](evidence/closeout-20261111/final-browser.log) |
| A-011 | PASS | Real Exporter shared-library path, Preview session tests and native source navigation pass. | [记录](evidence/closeout-20261111/final-regression-corrected.log) |
| A-012 | PASS | Existing source/metadata/edit/plan/cache limits pass; 100KiB 30-sample Node benchmark recorded with local scope. | [记录](evidence/closeout-20261111/final-source.log) |
| W-001 | PASS | Both real Windows runs pass ASCII no-include and direct-include geometry probes. | [记录](evidence/closeout-20261111/windows-run1-environment.json) |
| W-002 | FAIL | Unicode source alone crashes without any include; Unicode library root also fails. Same results twice. Further speculative fixes deferred. | [记录](evidence/closeout-20261111/windows-run1-environment.json) |
| W-003 | PARTIAL | ASCII Junction/copy/symlink pass; Unicode direct/Junction fail; fallback does not fix native source/output failure. | [记录](evidence/closeout-20261111/windows-run1-environment.json) |
| W-004 | PARTIAL | ASCII real LibraryEnvironment injection, mixed case and inherited multi-path pass. Unicode native path use fails. | [记录](evidence/closeout-20261111/windows-run1-environment.json) |
| W-005 | FAIL | Unmodified real Library test fails on Unicode input before successful v1→v2 geometry switching on Windows. | [记录](evidence/closeout-20261111/windows-run1-failure.log) |
| W-006 | FAIL | Two independent windows-2025 complete Library runs both FAIL, never W-PASS. | [记录](evidence/closeout-20261111/libraries-run1.json) |
| W-007 | PASS | Three-platform unit/contracts and Linux panel CI all pass; native Windows failure is separately retained. | [记录](evidence/closeout-20261111/parity-run.json) |
| D-001 | PASS | N-01..12 and split same-line/comment/string cases: 14 exact pinned native full-projection and Warning assertions pass. N-12 live cleanup separately observed. | [记录](evidence/closeout-20261111/pinned-current/pinned-native-override.json) |
| D-002 | PARTIAL | Real Host Warning/related locations and installed click navigation pass. Stale/wrong-target rejection is exercised in Chromium provider tests; separate installed Host stale-navigation-message injection was NOT RUN. | [记录](evidence/closeout-20261111/host-integration-configured.log) |
| D-003 | PASS | Real installed Sidebar all-lost/partial-lost states, navigation and unsaved repair cleanup pass. | [记录](evidence/closeout-20261111/installed-gui/result.json) |
| D-004 | PASS | Same fixed Production VSIX installed on 1.140.0; Source/Undo/Preset/ADR12 Host and real Sidebar checks pass. | [记录](evidence/closeout-20261111/artifact.json) |
| M-001 | PARTIAL | oMLX 0.7.3 / provider 0.1.2 / requested real model / Native 1.140 observed. API does not expose weight digest/revision or full sampler/KV settings; those remain unknown. | [记录](evidence/closeout-20261111/omlx-models.json) |
| M-002 | PASS | Transparent HTTP observer confirms all three Source tool schemas in actual Native requests; scoped tool picker 4–5 tools with provider limit16. Not a claim of all40 simultaneously exposed. | [记录](evidence/closeout-20261111/native-smoke-tool-exposure.json) |
| M-003 | PASS | Model-driven Analyze reads actual dirty-buffer hash, distinct from disk; not manual invokeTool. | [记录](evidence/closeout-20261111/native-smoke/review.json) |
| M-004 | PASS | Two independent authorized Native Analyze→Plan→Commit→Validate runs; actual buffer 3/3 targets, defaults/geometry preserved, disk unchanged. | [记录](evidence/closeout-20261111/native-author-reviewed-1/review.json) |
| M-005 | PASS | Tail plan rejected NEEDS_MANUAL_REVIEW once; complete explanation preserved, no fallback writer or false repair claim. | [记录](evidence/closeout-20261111/native-tail/review.json) |
| M-006 | FAIL | Expression scene completed Analyze only, no normal final response by explicit240s deadline. Buffer/disk unchanged. Further tuning SKIP per user after invalid initial environment and bounded rerun. | [记录](evidence/closeout-20261111/native-expression/review.json) |
| M-007 | PASS | Actual semanticPass=false plus missing-file ok=false truthfully reported, no edits or fake success. | [记录](evidence/closeout-20261111/native-failure/review.json) |
| M-008 | PASS | Actual reviewed Native Skip once; no Commit dispatch/replan/alternative writer, model stops and buffer/disk hashes unchanged. | [记录](evidence/closeout-20261111/native-cancel/review.json) |
| M-009 | PARTIAL | MODEL06 deterministic production replay/stale safety passes. MODEL07 real readonly state and JSON bytes preserved, but prose suggests possible truncation and unverified runtime unavailability. MODEL08 explains legal overwrite but reports fixture instead of actual dirty-buffer line numbers. MODEL09 is not globally accurate. | [记录](evidence/closeout-20261111/installed-production-focused.log) |
| P-001 | PASS | Fixed production candidate SHA/bytes, exact 40 tool schemas, 2 Instructions/5 Skills and 42 packaged runtime file hashes verified. | [记录](evidence/closeout-20261111/artifact.json) |
| P-002 | PASS | Clean isolated installed Production minimum VS Code1.140 Host and Sidebar pass after explicit native focus prerequisite; first failure retained. | [记录](evidence/closeout-20261111/installed-production.log) |
| P-003 | PASS | All current Native runs report exactly the candidate VSIX SHA and installed bundle digest; no later product-source/skill/catalog changes. | [记录](evidence/closeout-20261111/artifact.json) |
| P-004 | PASS | Historical artifact/report retained; current audit differentiates invalid tests, local/pinned/native/CI and both completion conclusions. | [记录](evidence/closeout-20261111/artifact.json) |

## 保留的边界和交接

- 真实 Windows desktop、WSL、Remote SSH、Container、精确 pinned Qt/GPU 交互，以及真实 Trust UI撤销：NOT RUN；不由 Windows runner或本机 Chromium推导。
- 单独 installed Host 的 stale-navigation 消息注入、所有主题/窄布局/控件组合仍缺本轮完整观察；相关行保留 PARTIAL。
- Windows 后续需由 CLI维护者提供独立 build 对照；模型后续需针对表达式停止/回复准确性和权重 provenance 单列新一轮，不覆盖本次结果。修改任何生产 Skill/catalog/schema 后需重包并重验，不能沿用本包模型 PASS。
- 本轮没有要求用户提供真实 profile或身份缓存，没有上传模型权重、token或用户项目源码。旧 [artifact.json](artifact.json) 与 [历史交接](final-delivery.md) 保留为历史，不能冒充本轮候选。

本轮对可执行轨道的验收与交接已完成；上述未通过项已明确记录并按用户要求暂缓。当前建议：保留为验收分支，不合并或发布为“全验收通过”。
