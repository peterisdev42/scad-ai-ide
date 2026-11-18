# Agent-Native CAD 未闭合问题与验收收尾

> 当前Agent验收必须使用Copilot harness / Agent Host，禁止Local回退。本文历史Local结果保留但不继承为Copilot PASS；最新入口、实际身份与最新阻断见[迁移记录](copilot-harness-acceptance.md)。

日期：2026-11-17。批准基线 `677dc681965e1d640ecf606f1ed0f60d1fe492a0`；实施分支 `codex/cad-acceptance-closeout`，承接 [PR #5](https://github.com/peterisdev42/scad-ai-ide/pull/5) 及 #4/#3/#2。本文是当前问题台账，历史记录不覆写；实际运行绑定见 [closeout 证据](evidence/closeout/)。原始需求与阶段边界见 [整体评估](overall-progress.md)。

Phase 5 MCP 已取消。全部业务能力只由 VS Code 插件向 VS Code 内置 Agent 提供。不新增外部 CAD 服务、公开端口、MCP 或工具。测试期间的本机模型转发仅用于观察既有 oMLX 请求，结束即停止。

## 交付与判定规则

这次收尾保持 **51 Tools / 12 Skills** 和所有业务授权不变。改进验收脚本和证据，再根据可复现事实修复产品；不会通过修改模型、Manifest、阈值、自动保存或降低 oracle 获取 PASS。

分别记录四类门禁：

| 门禁 | 完成条件 | 不能替代它的证据 |
|---|---|---|
| 功能自动化 | 最终候选确定性领域、CLI、原生 CAD Tool 与生命周期用例通过 | HTTP 200、空 Problems、工具返回 `ok:true` |
| Native Agent | 实际指定模型完成调用、获授权编辑、同基准复验及终态，满足场景全部断言 | 直接调用 API、另一模型的 PASS、旧 bundle 结果 |
| 手动交互 | [手动清单](manual-acceptance.md) 各子项由真人逐条记录 | 意愿回复、脚本点击、模拟 adapter 提交 |
| 平台发布 | 目标平台、最低支持版、Stable、installed 与 Unicode 专项通过 | macOS 子流程或未运行 |

一个门禁未闭合不撤销其他门禁中已经证明的事实，也不能签署整个 P1–P4 PASS。P0 保持历史签署。跨平台和最大规模耐久没有证据时保持 NOT_RUN。

## 统一验收顺序

1. `npm run test:cad:closeout -- baseline`：测试 harness、自有领域用例、真实官方 CLI、资源清单、冻结视图、生产构建，再用原生工具跑 CAD Host 专项。记录逐命令退出码和日志。该层不使用模型。
2. 冻结源码、harness、资源与构建 Hash。`docs/cad/evidence/copilot-harness/baseline.json` 必须 PASS 且与当前候选内容完全匹配，才允许真实 Agent；文档更新不改变候选身份。
3. 逐场执行 `npm run test:cad:closeout -- native diagnostics|mesh|assembly|comparison`。推荐模型仅用 **Qwen3.6-35B-A3B-OptiQ-4bit**，oMLX Provider 来自既有 **Run Extension + oMLX**。模型缺失明确失败，不选列表第一项或静默换模型。
4. 每候选／场景／模型最多一个正式尝试，预算 **600 秒**，包含启动、确认和推理；收集退出证据及清理单独记时。原子排他 reservation 防止不慎重复。历史 240 秒尝试保留为当时结果，本次是明确获准的新验收批次。开发定向测试不是签署，修改后必须重新冻结相关证据。
5. **Qwen3.8-27B-4bit** 仅在同一候选确定性层 PASS、主模型有明确参数／规划／延迟证据时最多对照一次。设置 `SCAD_AGENT_MODEL` 和 `SCAD_NATIVE_BACKUP_OF=<主模型result.json>`。缺少支持证据不跑对照；原主模型失败不被覆盖，备选 PASS 仅证明备选流程。单纯超时不自动获得“模型能力不足”标签或对照资格。
6. 真人定位、拒绝、焦点、实际不信任窗口及平台操作按独立手动清单执行。自动场景发现非允许确认即标 `MANUAL_REQUIRED`，不得假装模型仍在推理；手动交互不纳入自动超时，也不自动延长产品 TTL。
7. 在同一生产 VSIX 上记录完整最低／Stable Host 与 installed；焦点或平台缺口继续登记。通过草稿 PR 审阅，不修改 main、不自动合并发布。

测试控制器仅可确认 **临时 fixture** 的 `width=0; → width=1;`、`gap=0.18; → gap=0.30;`。控制器和 observer 两端均检查唯一替换、完整前后内容、规范路径、buffer/disk Hash、Manifest Hash 和一次限制。其他编辑（含反馈用例 hole=2→3）、工具确认和 UI 提交一律人工。产品工具没有新增 permission bypass。

## 必须保留的证据

每次执行记录：候选 ID、源码 HEAD／分支、实际 bundle/Worker/资源 Hash、宿主与 Provider 版本、准确模型 ID、工具筛选与实际请求 Schema Hash、原生会话 marker、模型原始工具参数、Dispatcher 接收到的参数、工具开始／结束与结果、报告／快照／artifact、命令终态、Provider headers／首字节／流结束／finish reason、确认节点、文档 change／willSave／didSave、buffer/disk Hash、Manifest/profile 字节 Hash、预算、退出码和未完成项。

VS Code 保存事件只公开 reason，不公开调用方。因此时间顺序只能支持“何时保存”，不能伪造保存调用栈或断言由 CAD 服务触发。模型流完成、工具完成、Chat command 完成与终态回复分别记录。超时后请求的 snapshot 只补观察证据，不能冒充终态。

`schemas-*.json`、原始 tool delta、`tool-traces.json`、`document-events.json`、`command-state.json` 以及严格 oracle 共同用于归因。没有原生 transcript marker 时拒绝把另一会话的最后回复算到本轮。凭据留在既有 SecretStorage；不读取、不迁移、不写入证据。只归档临时用例输出。

## 根因分类

| 分类 | 足够证据 | 后续动作 |
|---|---|---|
| `PRODUCT_DEFECT` | 合法输入在无模型的领域／原生 Tool 中可复现错误，能定位违反契约的行为 | 修实现并补有意义回归；重新冻结受影响候选 |
| `TOOL_CONTRACT_UX` | 文档／Schema／错误提示有歧义或原生暴露缺失，模型行为不能单独解释 | 修公开契约与投影，不新增旁路工具 |
| `MODEL_OUTPUT_ERROR` | 模型原始参数违背清楚的当前 Schema；宿主原样传达并正确拒绝，有终态证据 | 原失败保留；可条件式同场景备选对照 |
| `MODEL_PLANNING_OR_LATENCY` | 推理／流耗时与正确工具时间轴能隔离，环境／确认非主因；有人工审阅支持 | 记录模型与预算，不宣称永久无能力 |
| `PROVIDER_OR_HOST` | 认证失败、流中断、native session／工具暴露或保存策略有直接证据 | 定位对应层；不得改 CAD 数值或阈值 |
| `HARNESS_OR_ORACLE` | 会话误关联、错误预期、测试控制器越界、bundle 混用 | 修脚本；原失败留存，新批次独立记账 |
| `ENVIRONMENT` | 不可用 Runtime／显示／焦点／平台权限或指定模型缺失 | 明确受影响门禁，转人工或适合的环境 |
| `UNKNOWN_OR_MULTI_FACTOR` | 上述证据不足或因素叠加 | 保留候选解释、置信度与所缺证据，禁止武断归因 |

主模型和备选均失败，不等于功能缺失；确定性通过，也不自动证明模型是唯一原因。机器保守归因只是建议，人工可追加审阅说明，不能修改原始结果。

## 未闭合项目台账

以下历史状态均不因新脚本自动关闭。最新命令和新结果另见本批次 `delivery.json`（生成后链接）。每项保留原编号，新增定位信息追加到本节／机器报告。

### CAD-P1-AGENT-01：dirty 编辑发生保存

- 历史：最终 `22a6caa`、Qwen3.8／240 秒；断言发现后编辑 width=1，dirty=false，磁盘被写入原未保存内容。关闭 Save Before Send 与 Auto Save 仍发生。见 [历史记录](../cad-gate-p1-followup.md) 和 [原证据](evidence/2026-11-13-final-reaccept/summary.json)。
- 当前归因：`UNKNOWN_OR_MULTI_FACTOR`；CAD dirty 根读取已经由 Host 证明，未定位原生编辑保存源，不能称 CAD 功能缺失或模型能力不足。
- 修复／定位：对齐 native 编辑、保存 reason、buffer/disk Hash、Chat 状态和 Provider 请求。若宿主原生编辑明确设计为保存，按宿主行为记录，原 strict dirty Gate 继续开放；不恢复磁盘掩盖污染。
- 关闭：真实 Agent FAIL→原生编辑→新快照 PASS，Problems 撤销，assert/cube 保留，根仍 dirty、磁盘逐字未变。

### CAD-P1-AGENT-02：复验和终态缺失

- 历史：同次只有一次分析／一次编辑，无第二次分析和最后回复；HTTP 200 不证明完成。
- 当前归因：未知，可能模型规划／耗时、Provider 流或原生终态观测；没有足够证据指向功能缺失。
- 修复／定位：600 秒总预算；记录每段耗时，唯一会话关联、分离 stream/tool/command/assistant 终态。关闭必须真实新报告与当前状态均满足；截图或 timeout snapshot 不算。

### CAD-P1-COVERAGE-03：D/S 宿主矩阵缺口

- 历史 NOT_RUN／部分覆盖。对应 [覆盖映射](closeout-coverage.md)，不把同名 Node 测试说成全部 Host 已过。
- 自动补：Runtime／Library／Customizer／constraints 的失效、双 root、过期导航、取消／恢复和实例引用。已有确定性用例按实际范围归档。
- 仍需人工：M06 动态目录、M07 真正未信任窗口、M09 Unicode、M10 远程；没有环境则 NOT_RUN。关闭逐 ID 绑定实际测试和版本。

### CAD-P2-AGENT-01：单图参数与严格 oracle

- 历史：早期 `f823678` 下 verify→measure→getIssue→renderViews 实际完成，负 signedVolume=-1、physicalVolume=null、modelUnits 正确。模型省略 cameras，API 合法默认 3 图，严格单图断言失败；后续候选 NOT_RUN。见 [P2 验收](phase2-acceptance.md)。
- 归因：模型请求执行偏差／oracle 与默认行为的区别；不是网格测量缺陷。先核对当轮原始参数和当前提示，再判断契约 UX 是否贡献。
- 关闭：同一报告／快照依次四次工具；显式 cameras=["iso"]、恰好一帧冻结网格图片及元数据；负体积不取绝对值、单位和未决项正确；磁盘不变。

### CAD-P3-AGENT-01：路径别名修复后无真实修复证据

- 历史：listParts 成功，checkAssembly 因 `/var` 与 `/private/var` 返回 INVALID_PROJECT，属于已确认产品路径缺陷；已在后续实现修复、Host/installed 通过，最终模型未复验。见 [P3 验收](phase3-acceptance.md)。
- 区分：原失败是产品缺陷，不甩给模型；当前欠账为修复后的真实闭环证据。
- 关闭：读声明及规则→固定 Manifest digest 检查 FAIL→仅 gap .18→.30、允许保存临时 SCAD→同 digest 全必需约束 PASS；新 snapshot、原 ID/transform/阈值/Manifest Hash 不变；measure 与单图均指向新报告。

### CAD-P4-AGENT-01：比较报告参数误用

- 历史：Qwen3.6 调用 compare(reportId=raw v2)，未完成完整对比；后补 Schema／错误提示，无最终模型 PASS。见 [P4 原始轨迹](evidence/phase4/native-comparison/tool-traces.json)。
- 初步归因：`TOOL_CONTRACT_UX` 与模型参数混淆可能并存。当前工具区别明确后，仍须原始输出＋宿主拒绝＋终态一起支持模型归因。
- 关闭：当前 target verify，compare 显式 baselineReportId+targetReportId，固定 profile 检查，printability 永远 NOT_CHECKED；source／Manifest／profile 不被修改，变化与报告 snapshot 可追溯。

### CAD-P4-AGENT-02：真人空间反馈闭环

- 历史：单次定位确认未完成，无 handler 提交、编辑或修复。真人“方便”回复不算实际点击。见 [原确认记录](evidence/phase4/native-feedback/human-needed.json)。
- 归因：`MANUAL_REQUIRED`／宿主确认节点，不能认定模型或拾取功能错误。
- 关闭：M03 真人确认→表面点击→文本提交→获单独许可编辑 hole=2→3→固定 Manifest 复验→独立 shell unchanged→旧反馈 stale。M04/M05 分别验证拒绝、TTL、重映射；脚本点选不代签。

### CAD-P4-HOST-01：Undo/Redo/Enter 焦点

- 历史：两版完整 Host 各 56 PASS/1 PENDING/3 FAIL，installed 在焦点等待失败，业务子流程通过。
- 归因：实际 focus 前提未获得；不能仅据此排除产品编辑缺陷。M01/M02 分上下文人工验收；如果真人可稳定复现语义错误，另立 `PRODUCT_DEFECT`。
- 关闭：最低支持版及 Stable 原生交互逐项证据；原完整自动失败留存，手动通过标 MANUAL_PASS，不改成 automated PASS。

### CAD-P4-HOST-02：动态工作区变更

- 历史：updateWorkspaceFolders 被宿主拒绝／事件超时；当前默认 pending，显式 SCAD_TEST_DYNAMIC_WORKSPACE=1 可启用。
- 归因：宿主或 harness 原因未完全隔离；产品枚举核对目录归属不等于实际事件验收。
- 关闭：M06 真实 UI 加／移 root，保留数据消失于工具可见范围、撤销诊断且其他 root 不受影响，再加入后可正确读取；无越权读取。

### CAD-STORE-STRESS-01：完整容量、崩溃与压力

- 已有：引用租约、独立／最后取消、Worker timeout/crash 后恢复、Hash/CAS/锁／损坏／小容量用例。
- 欠账：最大 32 零件／128 checks／512 pair、百万顶点／50 万三角、500 万候选、满 512 MiB artifact／1 GiB review、真实跨进程崩溃／断电完整耐久。未运行的尺度不能由小预算测试推断通过。
- 关闭：独立压力批次绑定机器和预算；超限保留已知事实、不 PASS、恢复可用、活动引用不淘汰。真实断电不在用户机器上自动实施，M10 单独标注。

### CAD-RELEASE-01：Windows Unicode 与其他平台

- Windows Unicode 保持 `KNOWN_PLATFORM_GAP`。不能绕开中文路径、复制到 ASCII 目录或 skip 宣称修复。
- Linux、Windows、SSH、WSL、Dev Container 各自 NOT_RUN，见 M09/M10。功能开发继续，发布 Gate 不签署。

## 新结果填写规范

每项追加：`date / candidateId / scenario / model / result / expected / actual / evidence paths / category / confidence / alternatives / fix commit / retest candidate / manual case / closure decision`。失败只在满足其关闭条件且绑定新证据时关闭。新提交影响哪个 Gate，就重开哪个 Gate 的当前候选证据；不把已归档历史结果涂改。

当前实施与新执行结果统一归档 [本轮交付记录](evidence/closeout/delivery.json)；没有对应机器文件的项目继续明确标 NOT_RUN。PR 只交付收尾增量，main 与发布保持原状。

### CAD-P1-URI-04：CLI canonical URI 与编辑器路径别名错位（本轮新发现）

- 2026-11-17 原生 CAD 专项 **16 PASS / 1 PENDING / 4 FAIL**；失败在关闭文件 Problems、shared owner、共享 include 依赖 URI 和外部 LSP 去重。测试使用 `/var/...` 工作区，CLI 返回 `/private/var/...`，没有模型参与。原始日志 [保留于此](evidence/closeout/baseline-2026-11-17T01-17-40-461Z/cad-host.txt)。
- 分类：`PRODUCT_DEFECT`，证据支持；此前 P3 修复工作区查找不等于 P1 的诊断/依赖投影已处理别名。不能归为 Qwen 能力不足。
- 修复：安全校验和内容 Hash 仍按真实文件；可信诊断及工作区内依赖投影使用该文件所属工作区的编辑器 URI。路径权限边界不放宽。
- 回归：新增 canonical CLI path→root/include 编辑器 URI 的 Host 用例，同时检查隐藏 canonical alias 下无 orphan Problems、canonical/lexical 两种输入语义去重。待最终日志后判定关闭。

### CAD-ENV-PNG-02：当前隔离进程无法创建 CoreGraphics 上下文

- 首轮真实 CLI 的 CSG 诊断通过，两个 PNG 相关检查失败：`CGLChoosePixelFormat() failed: invalid CoreGraphics connection (10017)`。见 [原日志](evidence/closeout/baseline-2026-11-17T01-11-37-135Z/real-cli.txt)。
- 同一生产实现、官方 Runtime，在获准桌面图形访问后重跑 **3/3 PASS**。见 [复核](evidence/closeout/baseline-2026-11-17T01-17-40-461Z/real-cli.txt)。分类 `ENVIRONMENT`；本机原因已隔离，不改业务算法，不宣称无图形环境也能渲染。

### CAD-HARNESS-SESSION-03：当前 transcript 不保存用户 marker

- 本批次 P1 推荐模型实际完成首轮 FAIL 诊断，并输出严格允许的 width 0→1 patch；控制器因 transcript 内没有用户提示／marker 而未读取到工具参数，在确认前中止。没有应用编辑，没有保存污染，也没有第二轮复验。
- 原始结果标记 MANUAL_REQUIRED 但并非 edit 内容越界。原始 result 不改写；[审阅归因](evidence/closeout/native/diagnostics-Qwen3.6-35B-A3B-OptiQ-4bit-14909111-f485-4d1b-82f1-5e91c0d2ec93/assessment-review.json) 用原始 Provider 参数及完整 fixture 校验，分类 `HARNESS_OR_ORACLE`。
- 修复：关联“带本次 marker 的实际 Provider 请求 → 响应中的 tool-call ID/name/参数 → 原生 transcript 同一调用”；也兼容保留用户 marker 的版本。要求会话开始时间和唯一匹配，仍不按最近 CAD 对话选取。新增无用户消息／错误 ID／参数／时间的回归测试。
- 本交付不重试 P1；原执行保留，最终 harness 候选的 P1 标 NOT_RUN。不是模型失败，不符合备选模型自动对照条件。P1 两个历史门禁继续开放，后续新批次再安排。

## 2026-11-17 新批次实测（逐场追加）

### 网格主模型：PASS

- 冻结候选 `d88e72bced4562c562877f2273cc8dbdfafd55c92157461d0626fd7a349b119d`，代码/脚本 HEAD `4917290`，实际 bundle `59225b196f76fd7df1052725cf363c69099494abba36ac6e93319576fdc00384`。
- 推荐 Qwen3.6，单次约 **106 秒**，严格 oracle PASS、原生命令 completed。四个业务工具使用 report `cad-a5159476-b5bd-4069-ab88-91f2fba31466`、snapshot `b69797173d2a6d39ee3193eee85921b0d0126b89b142d448d6a7f9f86e306d8b`。模型本身为预期的反绕序 FAIL；**验收流程 PASS 不等于该模型合格**。
- signedVolume=-1，physicalVolume=null/UNRESOLVED，units=modelUnits；单 iso PNG，冻结源mesh Hash匹配、磁盘不改。见 [结果](evidence/closeout/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-d82dd059-5eba-4e18-97c8-97e03f13bac4/result.json)、[原始请求/Schema](evidence/closeout/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-d82dd059-5eba-4e18-97c8-97e03f13bac4/tool-exposure.json) 与同目录session-binding/trace。
- 模型先将可选 projectRoot 误填普通路径，收到错误后改成 file URI，并自行纠正一次测量请求。恢复发生在同一次尝试内，没有脚本代填参数。不是产品几何失败，也不证明模型完全不能用工具；不触发备选对照。
- CAD-P2-AGENT-01 的本地推荐模型核心流程现有当前候选 PASS；P2 整个 Gate 仍受手动／平台／规模证据边界约束。

### P1 新路径别名缺陷：自动化修复通过

- 产品修复提交 `d3586cc`；CLI/诊断别名先统一再去重，root/include 使用编辑器 URI，文件 stamp 始终用 canonical 键，保持所有输入前后复核。
- 新增纯服务回归和真实 Host 回归；最终 CAD 专项 **21 PASS / 1 PENDING / 0 FAIL**，包括此前闭合文件、共享owner、include、LSP去重与装配 dirty selector 场景。见 [最终确定性 baseline](evidence/closeout/baseline.json)。CAD-P1-URI-04 在该证据范围内关闭；不连带关闭 P1 旧模型保存/复验门禁。

### 装配主模型：PASS

- 同一最终候选、Qwen3.6，单场严格 oracle PASS。声明读取→固定基准 FAIL→仅原生修改临时 gap=0.18→0.30 并保存→同 digest 全必需约束 PASS，新 snapshot；随后测量及 iso 图片指向新报告。
- 每次 CAD 调用同时核对 Manifest disk/buffer Hash，最终源码逐字等于唯一允许的替换；部件 ID、变换、阈值、体积/尺寸约束保持不变。原生编辑此次直接执行，测试控制器没有合成批准；其权限来自既有原生配置与用户已授权的临时修复范围。保存行为属于本场明确允许的边界，不用它关闭 P1 strict dirty-buffer 项目。
- 证据：[result](evidence/closeout/native/assembly-Qwen3.6-35B-A3B-OptiQ-4bit-cb12403b-e46d-42d0-9d3c-4ca5aaa497b1/result.json)、同目录tool-traces、document-events、tool-exposure和session-binding。
- CAD-P3-AGENT-01 的修复后推荐模型闭环在本候选成立；P3 完整 Gate 仍不继承平台或未运行压力 PASS。没有备选对照需求。

### CAD-TOOL-UX-04：可选 projectRoot 错误提示仍可改善（非场景阻断）

- 本批次网格与比较两场均观察到模型先把 projectRoot 填成普通绝对路径，然后依据错误自行纠正为 file URI。合法输入的工具功能均正常；错误回复为泛化 OPERATION_FAILED / UriError，定位不如明确的 INVALID_INPUT 友好。
- 分类：`TOOL_CONTRACT_UX` 与模型可选参数使用偏差共同贡献；未证明业务能力缺失，不因一次参数错误认定模型不能完成。P2/P4 原始参数、宿主接收参数和纠正轨迹都保留。
- 当前状态：OPEN / 非关键提示改进；不改变最终冻结候选。后续可增强 optional projectRoot 的 Schema 示例／URI 格式与稳定错误码，并用确定性非法输入用例验证，不通过偷偷把用户路径转换成其他工程或放宽 Trust 修复。

### 比较/打印主模型：PASS

- 同一冻结候选、Qwen3.6，单场 **129 秒**，原生命令 completed、严格 oracle PASS。target verify→compare(baselineReportId,targetReportId)→显式 profile 打印筛查，regressionStatus=NO_REGRESSIONS_FOUND，printability=NOT_CHECKED。没有修改源码、Manifest 或 profile。
- [本轮结果](evidence/closeout/native/comparison-Qwen3.6-35B-A3B-OptiQ-4bit-1d229f3f-a600-458b-8ba4-66cced7251d0/result.json)，原始/宿主参数、Schema、会话和时间轴同目录保存。当前提示与 Schema 约定足以让推荐模型完成；旧 reportId 误用失败不抹去，也不外推为模型永远无能力。
- CAD-P4-AGENT-01 在本候选核心流程通过；真人反馈 CAD-P4-AGENT-02 仍 NOT_RUN，独立手动 M03–M05。当前三个最终候选自动模型场景都 PASS，P1是早一 harness 候选的测试缺陷中断；本批次 **未运行 Qwen3.8**，没有满足备选条件的可归因失败。

### 完整 Host：两版已执行项目全部 PASS，动态目录仍 PENDING

- 同一冻结候选，Stable **1.146.0** 与最低 **1.140.0** 均为 **60 PASS / 1 PENDING / 0 FAIL**，exit=0。原生 Undo/Redo/Enter 相关三个此前失败的焦点用例本轮实际通过；没有修改焦点实现。本轮可访问桌面环境中的结果更支持原环境/宿主前提解释，旧失败日志仍保留，不抹去或假称原来已过。
- 证据：[Stable 全日志](evidence/closeout/full-host-stable.txt)、[最低版全日志](evidence/closeout/full-host-minimum.txt)。CAD-P4-HOST-01 的当前自动化焦点缺口在两版范围内关闭。真人 M01/M02 仍可独立核对 UI 交互感受，不把本次自动测试说成真人结果。
- 唯一 pending 仍是动态工作区移除，CAD-P4-HOST-02 不关闭，M06 单列；真实未信任窗口、真人定位、平台与全容量压力不在这 60 项证明范围内。

### Installed 与版本核对

- 同一 VSIX 的 Stable 隔离安装 smoke **PASS、exit 0**，包括原先焦点停点及 CAD/review 业务子流程。见 [日志](evidence/closeout/installed.txt)、[实际结果](evidence/closeout/installed-result.json)。本轮 macOS Stable installed Gate 可在该 smoke 范围内签署；不推断其他平台。
- [73 项生产资产 Hash](evidence/closeout/archive-binding.json) 与当前冻结代码一致，VSIX SHA256=`b8baf69b34271736c6ed57e55494bf44d3a3ce8086fd14a52123980fbefa27d5`。原生模型使用development拷贝，资产相同；不把它谎称为installed模型会话。
- 执行时[官方更新页](https://code.visualstudio.com/updates/v1_146)为 2026-11-11 发布的 1.146.0 Stable；最低支持版1.140.0。公开版本API在web工具不可用，因此采用官网更新页与实际Host版本核对。

### CAD-HOST-LOCAL-05：测试路径与默认 Harness 的证据边界

- 本轮真实 oMLX 会话使用既有 F5 配置与 `workbench.action.chat.newLocalChat`（各原始 `local-chat-selection.json` 已归档）；它是 VS Code 内置 Agent 的 Local harness，不是外部 CAD Agent/MCP。51工具仍原生注册。
- [1.146 官方说明](https://code.visualstudio.com/updates/v1_146)已宣布 Local harness 弃用、计划在2027年2月移除。当前通过的 F5 路径不能冒充默认 Copilot harness／Agent Host 同样经过模型验收。
- 当前状态：兼容性证据缺口，默认 Copilot harness 未运行；不认定其功能缺失、不计入本轮三个已有F5模型PASS。后续需在默认harness中确认oMLX模型和原生工具可见性，迁移仍应使用VS Code原生API，不建设外部访问。手动检查见 M11。

### CAD-P1-URI-04 追加：POSIX 反斜杠边界与最终候选变更

- 最终代码检查发现跨平台分隔符正则会把 POSIX 文件名中的反斜杠误当目录；这可能把 `literal\\name.scad` 投影为实际另一个 `literal/name.scad`，属于本轮映射修复自身的边界缺陷，必须修正，不能为保留已跑证据而忽略。
- 改为原生 `path.join` 后再构造 file URI；新增实际 Host 测试同时创建“应FAIL的字面反斜杠文件”和“应PASS的嵌套诱饵文件”，检查读对源码、位置和Problems，不在错误文件发布。Windows的反斜杠是路径分隔符，因此该POSIX专项不对Windows代签。
- 该生产改动使候选内容Hash变化。此前 `d88e72...` 的三个模型PASS、60/1 Host及installed结果保持其原候选身份；最终候选另做确定性冻结、各一次推荐模型尝试、Host与同一新VSIX安装，不沿用旧PASS冒充新包验收。P1不重试，备选不作无证据补跑。

### 最终候选装配主模型：严格场景 FAIL，几何复验 PASS

- 候选 `f7e6300dddc12570b591b33942066cace6fa4322e8e5f616fc8d469f3252214f`、生产代码 `1d82001`，主模型Qwen3.6一次约189秒。原生命令正常结束，gap按允许范围修复，固定Manifest全部必需检查PASS、新snapshot；Manifest/ID/变换/其他约束保持不变。
- **场景仍FAIL**：没有调用明确要求的getIssue证据步骤；measure反复使用不合Schema的参数（包括uri+reportId并存），最终业务INVALID_INPUT，没有成功测量。截图/几何PASS不能补成完整场景PASS。
- [原始result](evidence/closeout/native/assembly-Qwen3.6-35B-A3B-OptiQ-4bit-239c9116-3eec-48b3-8d85-c97ad69fc69a/result.json)的机器UNKNOWN保留。[审阅归因](evidence/closeout/native/assembly-Qwen3.6-35B-A3B-OptiQ-4bit-239c9116-3eec-48b3-8d85-c97ad69fc69a/assessment-review.json)以原始输出、实际Schema暴露、Dispatcher参数、终态及同候选确定性PASS支持本轮 `MODEL_OUTPUT_ERROR`／步骤遵循不足。不是装配几何功能缺失，不声称模型永久不能完成。
- 竞争解释也保留：模型一度把harness跟踪UUID当reportId，注入的跟踪标记可能贡献计划混淆；不会把所有影响归给模型。此前同推荐模型在上一候选完成相同流程的PASS保留，说明结果有波动。
- 已满足同候选一次备选对照条件，授权审阅件为 [assembly-backup-eligibility.json](evidence/closeout/assembly-backup-eligibility.json)。只切Qwen3.8，不改提示、fixture预期或Manifest阈值；不覆盖主模型FAIL。备选结果另记，失败也不证明产品能力缺失。

## 最终生产候选汇总（覆盖上文的“当前”判断，历史结果不改写）

代码HEAD **1d82001**，候选 **f7e6300dddc12570b591b33942066cace6fa4322e8e5f616fc8d469f3252214f**，VSIX `.build/scad-ai-ide-closeout-final.vsix`，SHA256 **e95c1bcc90617b2fc63d41c047af0c6710f4f1fc135cd6531b36d46c2e35b3d0**。

| 项目 | 最终候选实际结果 |
|---|---|
| 默认/类型/lint/资源 | 446 PASS / 2 SKIP；类型、lint、51 Tools/12 Skills校验通过 |
| 官方CLI/原生CAD专项 | CLI 3/3；CAD专项22 PASS / 1 PENDING，含别名、POSIX反斜杠和装配原始输入复核 |
| 主模型网格 | Qwen3.6 单次约85秒 PASS，四工具、同快照、负体积/单位/单图正确 |
| 主模型装配 | 约189秒严格场景FAIL；几何修复与固定基准全约束PASS，但漏getIssue且测量请求INVALID_INPUT；详见审阅归因 |
| 主模型比较/打印 | 单次约127秒 PASS；正确baseline/target和NOT_CHECKED，文件基准不改 |
| P1模型 | 不重试；早期harness候选中断原记录保留，最终候选NOT_RUN，不关闭strict dirty Gate |
| 最低版完整Host | **61 PASS / 1 PENDING / 0 FAIL**，exit0 |
| Stable完整Host | **58 PASS / 1 PENDING / 3 FAIL**，exit1；原生焦点前提仍有波动，不沿用上一候选60/1全过 |
| installed | 同一新VSIX在最低/Stable隔离安装smoke均PASS，exit0 |
| 人工/平台/规模 | NOT_RUN分别列于M01–M11；Windows Unicode保持KNOWN_PLATFORM_GAP |

[最终资产绑定](evidence/closeout/archive-binding-final.json)、[Stable最终日志](evidence/closeout/full-host-stable-final.txt)、[最低版最终日志](evidence/closeout/full-host-minimum-final.txt)、[Stable installed](evidence/closeout/installed-final.txt)、[最低 installed](evidence/closeout/installed-minimum-final.txt)。当前CAD-P4-HOST-01 **重开/仍OPEN**：上一候选的自动通过是真实的，但最终候选Stable再次失败，不能签稳定焦点Gate；人工M01/M02需要区分焦点环境与实际编辑语义。动态目录CAD-P4-HOST-02始终未闭合。

主模型最终装配失败满足一次备选对照条件；备选结果在随后追加行及机器delivery单独记录。任何备选成功都不会覆盖主模型FAIL。测试副产物保留在隔离临时路径，未修改用户模型或main，没有发布。

装配归因补充：`getIssue` 是当前严格oracle要求的独立步骤，初始装配摘要也可能已有足够的失败事实，后续应区分“未另调深度证据工具”和“根本没读到证据”，不能仅按调用次数断言模型不理解问题。此部分的oracle冗余风险已加入审阅竞争解释。本场**没有成功测量、原始测量参数违反Schema**是独立且可复核的失败事实；备选对照据此安排，未降低原断言或签PASS。

### 最终候选备选装配：Qwen3.8 PASS（主模型FAIL保留）

- 严格按一次条件式对照：**Qwen3.8-27B-4bit**，同一 `f7e630...` 候选、同一提示模板、源fixture/Manifest与黄金预期，600秒预算；实际 **586758 ms**，exit0、原生命令 completed、所有严格断言PASS。
- 两次装配报告分别 `cad-77f1a617-096f-4645-9494-de8cc889950a` FAIL 与 `cad-19dc665d-aeca-47d7-bb87-84ef81b9b2a0` PASS；manifestDigest始终 `c04e983d9d0417242c5e59c843c56ca130a418ff0296f3b0669ae96b587c127f`，不同snapshot。getIssue、成功测量与冻结单图均实际调用，源码只改gap，Manifest、ID、变换和约束不改。
- [原始结果](evidence/closeout/native/assembly-Qwen3.8-27B-4bit-38ecf9ec-35da-4eb2-9288-88ed5c4c8c93/result.json)、同目录实际Schema/原始参数、trace、document-events及会话绑定。约8.8秒开始流响应，首次进度约273秒，首业务调用约287秒；随后也纠正了普通路径→URI。耗时包含本机推理与Provider背景请求，单样本不作通用模型排名。
- 结论：**装配接口/几何/修复/测量闭环可用，备选在本场完成；推荐模型本场有参数和流程遵循失败**。不能据主模型失败说功能缺失，也不能据备选成功把主模型改成PASS。当前P3 Native结果按模型分开：Qwen3.6 FAIL、Qwen3.8 PASS；P1、人工反馈、Stable焦点和平台门禁仍OPEN。

## 交付

独立草稿 [PR #6](https://github.com/peterisdev42/scad-ai-ide/pull/6)，面向main、依赖#5/#4/#3/#2。请按[相对677dc68的增量](https://github.com/peterisdev42/scad-ai-ide/compare/677dc681965e1d640ecf606f1ed0f60d1fe492a0...codex/cad-acceptance-closeout)审阅本轮，原始证据单独提交。最终生产候选仍为1d82001；后续交付提交只追加文档/证据，实际HEAD见PR。main维持8a3ff1fe，不自动合并或发布。手动夹具已准备，选择CAD Manual Acceptance + oMLX按F5即可逐项记录，未将任何未执行人工条目标为PASS。
