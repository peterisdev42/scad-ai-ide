# Agent-Native CAD 未闭合问题与验收收尾

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
2. 冻结源码、harness、资源与构建 Hash。`docs/cad/evidence/closeout/baseline.json` 必须 PASS 且与当前候选内容完全匹配，才允许真实 Agent；文档更新不改变候选身份。
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
