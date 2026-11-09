# Customizer 实施与验收进度（2026-11-09）

## 当前结论

Phase 0 / 0.5 产物已完成：[审计](customizer-audit.md)、[ADR 与逐模块决策](customizer-architecture-adr.md)。用户已批准方案 B 及后续 Phase 1–4，附五项约束，已纳入 ADR。目标保持 active，尚未验收完成；没有合并 main。

当前实施：Phase 1 语义修正及 41 例 CLI 差分已通过；Phase 2 规则/事务/状态已实施，最低 Host 原生焦点/Undo/Redo 验收已通过；Phase 3 主路径部分 Preset 切换、未知版本只读与 Preview 领域服务统一已实施，写入事务和生命周期继续验证。Phase 4 最终发布物/真实模型/跨平台验收未完成。

### qwen3.5:2b-mlx 原生验收推进

用户指定的模型已从本机 Ollama 核实（digest、能力和参数见 `customizer/evidence/qwen2b-model.json`）。原生 Agent 已就绪并实际调用 Source 工具，先前环境阻断已解除。测试使用隔离 profile/shared-data-dir/extensions，禁用更新，仅配置临时 fixture 的内置 Chat 扩展启用迁移状态；没有更改认证、账户或 entitlement。

新增 ADR09：Source Apply 提供根 object/properties，保留两模式接受集合。旧 schema fixture 与新 schema 对照、31 项 capability 测试通过。Skill 进一步明确 numeric version/hash 的嵌套 identity、真正 planId 来源以及 edits 的数据结构；没有放宽校验。原生测试发现 identity 用法已有正确调用，但仍有缺字段、分组安全拒绝及未完成记录，不将 schema 对照测试算作模型通过。

当前模型验收：MODEL-01 最终三目标复测Analyze后native no response，无Plan/Commit/Validate，buffer/disk原样且无确认拒绝/观察超时，未通过；MODEL-03 已实际 Analyze，源码未变、未称语法错误，但最终说明存在错误控件和虚构 slider 用法，记 Partial；MODEL-04 未调用目标工具并原生报 no response，未通过。MODEL-02 已实测失败：3次 Analyze、0次 Apply/Validate，源码仍是 spinbox 且未改动；模型却声称已编辑/保存。此前尾注/完整编辑测试被后续确认弹窗阻断的脚本限制如实保留，已修复观察脚本后继续；不从这类超时推断模型推理失败。

新增证据：固定种子 1200 例长尾注/source45 PASS；1 轮预热+6 轮实际类内存测量，32 文档/32 source plans/32 editor plans，cache16，dispose 后 maps 和3订阅归零（非全 VS Code heap profile）；真实 Host Preset 文件创建/rename/metadata/外部 watcher/未知版本拒绝定向1 PASS。首次新用例缺 name 被 schema 拒绝，修正测试空 name 后通过，未削弱生产校验。完整 Host 增至32项：首次31 PASS/1 FAIL（native输入多出fu），定向1 PASS，未改产品/断言的全新profile整套复测32 PASS。偶发输入失败根因未证实，保留失败证据。

### Phase 4 当前实测更新（覆盖早期快照）

- `npm test`：core212 PASS / preview99 PASS / library26 PASS、3 SKIP（`/tmp/customizer-final-schema-regression.log`）；随后显式提供真实CLI/Exporter并启用online补跑library：29 PASS、0SKIP。没有把先前SKIP改写成当时通过。
- 浏览器最终35 PASS（`/tmp/customizer-phase4-spinbox-ui.log`），含真实Chromium pointer/keyboard、两套文本/数字控件、共同Preset domain、incomplete与原生Accessibility tree。
- **最低 Host1.140.0 最新32 PASS**（`customizer/evidence/host32-repeat.txt`）。首次32项运行31 PASS/1 FAIL，native输入出现额外fu；定向1 PASS后整套重跑通过。未修改产品/断言以忽略额外文本。早期31项原生Undo/Redo/Enter证据仍保留。
- 当前候选 VSIX 为137文件、4,532,700 bytes，SHA256 `5cd831f6e9bbc2772be7db99f09f4e31fb15d26fc2745f81073223ec59cb652e`。40 tools/2 Instructions/5 Skills验证及最低Host隔离Production安装通过；精确元数据见 `customizer/artifact.json`，新证据文件名含explicit-contract，不沿用旧产物结论。没有合并/发布main。
- native Chat：用户指定 qwen3.5:2b-mlx 后，原生 Agent 已就绪并实际执行工具。当前结果见上方与模型证据目录；旧环境阻断仅作为历史事实，不再代表当前状态。未以 SDK loop、合成 tool calls 或空 command result 代替原生验收。
- 持久化脱敏运行证据归档于 `customizer/evidence/`（包含旧失败与最新成功），manifest记录原日志hash及前缀脱敏。当前Before/After及模块清理见 [交付检查](customizer-delivery.md)。

本轮清理：Preview preset writer/replay及4个无生产调用的旧ScadParameters方法删除；生产只有共同domain选择/写入。ScadParser迁移到同一有界Analyzer，partial源码不再过滤回写Overrides。numericInput的step=any消除原生stepMismatch，键盘/指针显式使用交互增量；不改变Agent/Preset off-grid值。新规则/兼容references随VSIX安装。

当前目标仍active。剩余未通过/未执行项：原生Chat模型完整任务、Windows/Linux/Remote、native Desktop、完整pinned binary、heap profile。没有在这些条件缺失时标全目标完成。

### 较早阶段快照（历史）

| 范围 | 实际结果 | 证据/限制 |
|---|---|---|
| 独立兼容门及 CLI 差分 | 41 PASS / 41 MATCH | `/tmp/customizer-phase1-compatibility-41.log`；`customizer/native-phase1.json`。CLI 非 pinned 全程序，相关源码相同 |
| 原生导入探针 | 6 PASS | `customizer/native-import-phase3.json`；包括文本 UTF-8 字节截断、off-grid、布尔0/1、混合枚举顺序 |
| Phase 2 Source / capability | 36 / 27 PASS | `/tmp/customizer-phase2-metadata.log`、`/tmp/customizer-phase2-editor-unit-verified.log` |
| Phase 3 主 Preset 浏览器路径 | 28 PASS | `/tmp/customizer-phase3-presets-ui.log`；包含 A→B→Default、未知版本只读；不是后续统一的最终结果 |
| 最新 npm test | core 204 PASS；library 26 PASS / 3 SKIP；preview 98 PASS | `/tmp/customizer-phase3-unified-all2.log`；包含事务5项及 Preview 域路由2项；第一次编译因 Thenable/Promise 适配失败，已修正并重跑 |
| VS Code 1.140.0 最新 Host | 27 PASS / 3 FAIL | `/tmp/customizer-phase2-host-minimum.log`；2项 native Undo/Redo 与1项 native Enter 均因窗口无法取得原生焦点失败。API buffer/CAS/outside-workspace/untitled/readonly通过；不能推断原生交互通过 |
| 新 Preview 统一后的浏览器/Host/VSIX | IN PROGRESS / NOT RUN | 不沿用旧发布物或旧 Host 通过结论 |

版本勘误：早期集成测试日志实际 `Validated version: 1.145.2`，并非 1.140.0。只有明确指定的 installed smoke 和上述 minimum Host 证明 1.140.0；`.vscode-test.mjs` 现在显式默认最低版本1.140.0。下方早期结果均为历史证据。

实现边界：StringParameter 构造器的 maximumSize 参数遮蔽成员，`.param` 保留声明长度；native import 对 UTF-8 字节 substr 截断可能破坏字符。IDE 分离 declared/effective、输入转换、校验、交互增量和存储：不自动截断用户文本、不把 step 当数值合法性网格。未知版本保留原数据且可只读分析，未经兼容验证拒绝应用/覆写。

新增存储保证：扩展内同 URI 写入串行；暂存前后检测原始 bytes 与目标修订；同 provider rename 原子替换；失败清理临时数据。最终 read 到 rename 之间仍存在其他进程竞态，provider 的 rename 能力与平台表现尚须验收，不宣称跨进程 CAS。

## 初始审计阶段实际变更（历史）

- Parser 的 literal、annotation、领域类型分别移入 CustomizerLiteral / CustomizerAnnotation / CustomizerModel；保留原导出适配，无第二套执行路径。
- validateValue 与 numericStep 移入 browser-safe CustomizerConstraints，Service/Parser 保持原导出。DOM 消费迁移与去重等候相应行为决定。
- 新增 30 例固定参考 SHA 的兼容 fixture、真实 CLI 差分 runner、部分 Preset 切换复现 runner及 2 个 corpus/lexical 测试。
- `.vscodeignore` 排除 `.playwright-cli/**`，防止开发截图进入发布物：本次实测 184→141 files、4.59→4.35 MB。没有删除用户文件。
- 分支 `codex/customizer-architecture-v2`；起点 main `4463d61046d962a3f5afa5ace49b21f37e6cc4a6`；上游 `bcf45a22caa954ca56ca287994cb6dbc368c67b2`。没有提交、合并或发布 main。

## 本次执行记录

macOS Darwin 27.0.0 / arm64 / Node v24.16.0。以下证据均为本次运行，日志在 /tmp（临时文件并非永久交付）；可重复入口已入仓库。完整性判断只依据表中实际范围。

| 命令/环境 | 结果 | 证据与限制 |
|---|---|---|
| npm run test:customizer:source（基线） | PASS 25 | /tmp/customizer-baseline-source.log |
| npm run test:capabilities（基线） | PASS 24 | /tmp/customizer-baseline-capabilities.log |
| npm run test:customizer（首次沙箱内） | FAIL 环境 | Chromium macOS Mach bootstrap permission denied；没有跑成 UI 测试 |
| npm run test:customizer（基线沙箱外） | PASS 24 | /tmp/customizer-baseline-ui-unrestricted.log |
| npm run test:customizer:source（提取后） | PASS 27 | /tmp/customizer-audit-source.log，新增 2 项；其余未改断言 |
| npm run test:capabilities（提取后） | PASS 24 | /tmp/customizer-extraction-capabilities.log |
| node --test out/test/customizer.test.js | PASS 15 | /tmp/customizer-extraction-core.log |
| npm run check-types | PASS | /tmp/customizer-extraction-types.log，生产构建再次执行 |
| npm test | PASS；3 SKIP | /tmp/customizer-audit-full-tests.log：核心 182/182，libraries 26 pass/3 skip，preview 95/95。SKIP 不算通过 |
| SCAD_TEST_WORKSPACE=/tmp/customizer-host-workspace npm run test:integration（首次） | FAIL | /tmp/customizer-baseline-host.log：25 passing / 1 failing，缺 SCAD_PREVIEW_EXPORTER |
| SCAD_TEST_WORKSPACE=/tmp/customizer-host-workspace SCAD_PREVIEW_EXPORTER='<managed-preview-exporter>/bin/openscad-preview-exporter' npm run test:integration | PASS 26 | /tmp/customizer-audit-host.log，真实 VS Code 1.145.2（原记录版本已勘误）。source tools 未保存/CAS/Problems/GUI schema、值/CLI、LSP、Markdown、Library Host |
| npm run package | PASS | /tmp/customizer-audit-package.log：check:agents / check-types / lint / production bundle / licenses，不能单独证明业务正确 |
| npx --no-install vsce package ...（首次） | FAIL 环境 | /tmp/customizer-audit-vsix.log：本地无 vsce executable，npm cache 写受限；未修改用户 npm cache |
| node /Users/q/.npm/_npx/66fbc91407e86cd3/node_modules/@vscode/vsce/vsce package --no-dependencies --out .build/scad-ai-ide-customizer-architecture-audit.vsix | PASS | /tmp/customizer-audit-vsix-final.log，直接复用已缓存 vsce；执行 prepublish 的 LSP/production build |
| npm run verify:agents:vsix -- /Users/q/Documents/Code/scad-ai-ide/.build/scad-ai-ide-customizer-architecture-audit.vsix | PASS | 40 tools / 2 Instructions / 5 Skills / extension + AI assets |
| npm run test:agents:ui（沙箱外） | PASS 1 | /tmp/customizer-audit-agent-ui.log，真实浏览器 AI panel，非真实模型 |
| npm run test:customizer（最终沙箱外） | PASS 24 | /tmp/customizer-audit-ui-final.log，模块提取后最终浏览器回归 |
| SCAD_VSCODE_EXECUTABLE='<repo>/.vscode-test/vscode-darwin-arm64-1.140.0/Visual Studio Code.app/Contents/MacOS/Code' npm run test:agents:installed -- <absolute-VSIX> | PASS | /tmp/customizer-audit-installed.log；隔离临时 profile/extensions/workspace，Production Host，LM invoke/read + service source plan/commit，disk unchanged/single-use；不等于真实模型调用 |
| node scripts/customizer-native-audit.mjs '<managed-runtime>/bin/openscad' docs/customizer/native-before.json | EXECUTED：20 MATCH / 10 DIFF | 30 例真实 RC0 CLI，10 个差异不是通过。native binary 非 pinned；相关 Customizer 实现文件 diff 为空 |
| node scripts/customizer-preset-audit.cjs docs/customizer/preset-before.json | EXECUTED：残留确认 | injected read-only I/O；A width=30 → B height=40，width 仍为30；Design default 清空。不是 Host E2E |
| git diff --check | PASS | 无 whitespace errors |

`npm test` 的 3 个 SKIP 为依赖环境的独立 Library 测试，具体名称见临时原始日志；不能将整个 suite 写成全测试通过。

## 上游与回归证据

- [native-before.json](customizer/native-before.json)：actualNative / actualIDE / diagnostics / projections / binary commit，30 例。
- [preset-before.json](customizer/preset-before.json)：部分集切换的真实业务对象结果，Host I/O 注入身份显式标记。
- 上游可执行程序 build `9ba0cee7c94785fac0ca8dfe040b965a12a25ed1`，pinned `bcf45a22...`；相关实现对照命令：`git -C sources/openscad diff 9ba0cee7c94785fac0ca8dfe040b965a12a25ed1 bcf45a22caa954ca56ca287994cb6dbc368c67b2 -- src/core/customizer src/io/export_param.cc`，输出为空。Pinned binary 全程序一致性仍 Unverified。
- Native 额外实测：带 `fileFormatVersion:"99"` 的 OffGrid set `w:"12",v:"[3,5]"` 被 CLI 接受，echo `w=12,v=[3,5]`；当前 IDE 的未知版本/网格拒绝存在可见差分，等待确认策略。
- 本轮 source 反例测试实际通过：无 Hint、表达式、Hidden/Global、有效重复赋值、off-step、缺省下拉默认项、闭括号后 prose 均默认无虚假 Problems；原 2026-11-09 低噪音政策未回退。
- 107124 bytes analyzer 本次 p95 2.19 ms；本机基线 source log 可复查之前值，不推断其他平台。没有进行 heap/订阅内存基准，不宣称完成。

## Before → After 能力状态

Phase 0 全能力矩阵见 audit。此次内部职责提取没有修正可见行为，因此 schema/控件/Preset 行为状态保持 Before，native 已证实缺陷仍 Broken/Partial。Host tools、GUI、资源链的证据从仅静态/Mock 增强为本机真实浏览器、Host、installed smoke；因为缺陷与模型/native 未验证范围，整个子系统仍不能标 Complete。

## 初始审计阶段剩余工作（历史，已被上方进度更新）

1. 等用户答复 ADR 的可见行为修正和未知 Preset 版本策略；依赖这些决定的实现不先行。无需重新确认内部重构授权。
2. Phase 1：修正 description、NFC、首花括号行/同一行多个声明、Hint lexer、declared/effective。全量 native 30 例重新对照，不为 green 修改事实。
3. Phase 2：catalog/evidence/fix、command CAS、状态分离/details、DOM 共享校验与完整性/无障碍；补 Host stale/Undo/safety 测试。
4. Phase 3：部分集切换、结构化 Preset diagnostics、无损版本策略、I/O 竞态与 watcher、Agent resources 引用；运行实际 GUI/Preview/Tool 路径。
5. Phase 4：最终 VSIX 重建和安装、清理、Before/After 矩阵、性能/安全/回归与最终验收报告。
6. 真实模型 MODEL-01..04、pinned native binary、OpenSCAD Desktop GUI、Windows/Linux、SSH/WSL/Container、heap/订阅销毁测试：NOT RUN / Unverified。本轮没有借 Mock 或 macOS 结果替代。

风险边界：未改用户模型和 Preset；本轮真实 Host 写入限定隔离临时测试文件，源码工具仍保持 workspace/trust/version/hash/TTL/一次性计划/不保存；尚未修复的 Quick Fix 过期快照和 Preset 外部写入竞态已明确列入下一阶段。最终验收未完成，不宣称已交付整个 SPEC。


## 第二轮续作：独立验收门与 Host 生命周期证据

上一轮属于 progress：改变了源码职责边界并取得真实 native/Host/VSIX 证据。本轮也取得新证据，没有把自动续作当作两项待确认决定的批准。

- 新增 [SPEC 编号验收台账](customizer-acceptance.md)：UT-01..20、HOST-01..06、MODEL-01..04、§12 DoD 逐项核对；Partial/FAIL/NOT RUN 保留，不从旧 green 推断完成。
- 新增 `npm run test:customizer:compatibility` 严格门。期望来自 native 目标，旧 IDE 输出只保存在 baselineIDEParameters；30 例执行得到 20 PASS / 10 FAIL / 0 SKIP / 0 TODO，exit 1。证据 `/tmp/customizer-continuation-compatibility.log`。十个失败见台账，产品修正仍待确认。
- CLI/静态验收共用 `src/test/fixtures/CustomizerCompatibilityProjection.ts`；投影增加 group 与可导出的 step；不声称覆盖 Desktop 交互。`node scripts/customizer-native-audit.mjs <managed-RC0-bin> docs/customizer/native-current.json --strict` 本次 exit 1，20 MATCH / 10 DIFF，无 native fixture 漂移。首轮 native-before.json 保留原始事实，不覆盖。
- 源码既有测试重新执行：`npm run test:customizer:source` PASS 27（`/tmp/customizer-continuation-source.log`）。`check-types`、`check:agents`、`lint` 和 `git diff --check` 通过；没有为十个已知兼容缺陷修改产品断言来制造 green。
- 扩充 `capabilities.integration.test.ts`：源码 commit 后真实 Undo 只撤销该事务，原先 unsaved 注释保留；Redo 恢复并重新验证。实际开启/关闭 diagnostics、保存、实际 document close 后不重发也已执行。
- 首次新增 lifecycle 测试失败：`/tmp/customizer-continuation-host.log`，25 PASS/2 FAIL；第二个失败由测试清理后的 target 残留影响相邻 suite。定位运行 `/tmp/customizer-continuation-lifecycle-debug.log` 0 PASS/1 FAIL 显示 `{closed:false,problems:[],tabs:[]}`：磁盘文档在最后标签关闭后仍可被 Host 缓存，不能把关标签当作 document close。
- 修正测试的宿主假设：保存生命周期仍用磁盘文件，实际关闭事件用可丢弃的 untitled .scad buffer，并正确清理共享 Customizer 状态；没有因此修改产品代码。以相同隔离工作区与 Preview Exporter 环境运行 `npm run test:integration` 最终 PASS 27（`/tmp/customizer-continuation-host-final.log`，exit 0）。

这轮只增加验收基础设施和真实 Host 证据，未改变待确认的公开语义。上一轮 VSIX 是当时产物；当前测试文件/测试脚本增加未重新标作已安装版本，最终 Phase 4 仍需重建。待确认的两项问题仍有效，不重复发起确认。Phase 1–4 完整实现与验收仍未完成，goal 保持 active。

## 第三轮：阻断审计

- 重新读取了 git 状态、ADR 待确认清单、最终 Host 日志和严格兼容门日志。上一轮属于 progress（新增严格门和 Host 生命周期/Undo 证据）；本轮状态核对本身不计作实现进展，也不算 verified wait。
- 没有收到对两项问题的用户答复。自动 goal continuation 只表示继续追求目标，不授权越过用户设定的公开行为确认边界。
- 当前关键路径的下一步是公开行为修正：description/NFC/首花括号行/Hint lexer、有效范围与步长策略、部分 Preset 切换、Quick Fix 执行边界与新增输出。ADR 已给具体可审阅方案；内部行为保持的提取、独立差分/基线/Host/打包可达性证据已推进，不能继续用重复测试替代需要决策的实现。
- 原始用户回合和两次续作中，同一确认门槛持续存在，达到三回合阻断审计条件。本轮将 goal 状态设为 blocked，等待用户确认，而不是 complete 或 paused。完整 Phase 1–4 目标保留。
- 请求答复两项：①批准 ADR 中已列明的可见行为修正，或指出需要保留的行为；②未知 Preset fileFormatVersion 改为保留数据、信息提示并继续结构验证，还是继续拒绝。两项可以分别决定。
- authoritative state：分支仍为 codex/customizer-architecture-v2，未合并 main；Host 最后运行 exit 0 / 27 passing；严格兼容门 exit 1 / 20 pass / 10 fail。没有后台运行需要继续轮询，也没有将未执行验收改为通过。

## 用户批准后恢复实施

已收到对方案 B 与后续开发的批准。用户明确批准 partial Preset defaults+当前集；要求重新核实 StringParameter 参数遮蔽与截断、分开输入校验/转换/规范化/有损处理、分别评估 editor/Agent 编辑限制、未知版本可只读分析但应用/覆写需兼容依据。ADR 已追加修订，覆盖此前待确认建议中冲突部分。现在按 Phase 1–4 继续，不再重复请求这些决定。

## 指定模型本轮收尾

MODEL-01/02/04均未通过，MODEL-03仅部分满足。最终矩阵、复现入口和实际调用见 [qwen3.5:2b-mlx模型验收](customizer/model-acceptance.md)，摘要见 `customizer/evidence/native-agent-summary.json`。观察脚本曾有后续弹窗、transcript完成检测和中断快照缺口，修正及旧失败均保留；最后author请求实际native error，不是旧脚本超时。未以改变工具接受集合或降低安全性换取模型通过。

本轮新增公开schema传输投影的合法输入集合保持证明见ADR09；Skill仅明确已有契约。代码回归最新core212/Preview99/浏览器35/最低Host32；Library默认26+3SKIP，真实环境另跑29；新VSIX验证和最低HostProduction安装均PASS。首次32项Host的native输入额外fu失败、定向通过和整套复测通过并存，偶发根因未知。

main未合并；实现保留在独立分支；阶段进度和未验收范围保留，目标未标complete。

## 本轮：真实 Host heap 与官方 Desktop 前提

本轮是实际进展：新增真实Host内存入口及三快照证据，补齐服务实例计数的占用/回收对照；官方GUI下载包SHA256已核对，实际Desktop CLI 41 MATCH。见 [生命周期验证](customizer/lifecycle-validation.md) 与 `customizer/evidence/native-desktop-artifact.json`。未改产品语义，也未移动main。

原生GUI第一次CFFIXED_USER_HOME隔离假设失败，只改变recentFileList；已在当前SHA与测试结果匹配时用启动前备份恢复，验证原偏好值一致。之后以macOS sandbox同时拒绝偏好写入和真实home文件写入，拒绝探针通过，后续窗口测试偏好SHA不变。保留此失败与恢复证据，不称所有测试一直无副作用。

用户已选择为Codex开启辅助功能，实测Accessibility和CGPostEvent均true；当前真实阻断是锁屏，不是权限未授予。合成模型窗口仍在有界存活，等待解锁后继续；截图SCStream -3811、无法激活与不完整AX树均未记通过。

原生GUI逐项待测、官方二进制及初次偏好隔离失败/恢复见 [原生GUI台账](customizer/native-gui-validation.md)。用户已批准辅助功能；实际权限true，当前需解锁，不重复请求同一授权。

## CI 基准失效修正与待运行的新提交

只读GitHub核实远端main仍为4463d610。该基准的真实Actions run42550718492失败：Windows check:agents的LF-only frontmatter断言拒绝CRLF；Linux panel缺dist/panel-scrollbar.css。旧macOS/Ubuntu contracts成功只是旧main证据，不作为本次变更通过。

修正Agent verifier按语义归一CRLF读取Markdown及生成报告，严格保留内容漂移拒绝；LF/CRLF隔离树正例与过期内容反例均通过（2项测试）。Library UI独立命令先build；确实移除生成CSS后执行，6项浏览器测试通过。Architecture CI需要固定基准Git对象，contracts checkout改fetch-depth0。

新137文件VSIX为4,532,774 bytes，SHA256 41b515c77f65b7636cb140e8d59b1520d58d56dd4388ce65f9a1eb7eea67f22d，manifest校验和最低Production安装通过。旧artifact元数据已标历史，模型失败仍关联当时产物。下一步提交独立分支执行真实跨平台CI；当前尚未宣称新CI通过。

原生有界窗口进程已结束，未取得有效AXWindow/截图，不计控件PASS；其结果确认源码和用户偏好SHA均未变。权限已授权，仍等待Mac解锁后新建测试进程。
