# Agent-Native CAD 整体进度评估

评估日期：2026-11-16。核对基点：`677dc681965e1d640ecf606f1ed0f60d1fe492a0`，分支 `codex/cad-diff-feedback`；最终生产验收代码为 `48d194e22ab3dd1afdfa574e78091935f623bbce`。本次核对批准的完整路线、后续 P2/P3/P4 实施边界、代码入口、机器证据与 GitHub PR 状态，没有重跑验收。

## 当前目标范围

用户已明确取消 **Phase 5：可选 MCP**。它不再是后续开发任务、验收门禁或完成率分母。

交付目标为 VS Code 插件内的完整 CAD 工作流，向 VS Code 内置 Agent 原生注册工具、Skills、报告与图像，并复用 Problems 和 Preview。当前 `registerAgentTools.ts` 已使用 `vscode.lm.registerTool` 注册这些能力。F5 oMLX 是该内置 Agent 的模型 Provider；不要求构建独立 CAD MCP Server、外部 HTTP API、跨 Harness 访问或可移植 Agent Plugin。

官方 CLI、隔离 Worker、本地 artifact/store、虚拟文档及 Workspace Trust 继续属于插件内部实现。取消 MCP 不取消 VS Code 跨平台／远程 Extension Host 的正确性要求。

## 整体判断

代码覆盖已经到达 Phase 4，当前处于集成收尾与验收闭环阶段。核心领域服务、原生 Agent 入口和自动化基础已落地；不能将阶段代码交付、工具数量或子流程通过等同于完整产品验收。

| 阶段 | 已交付能力 | 当前验收判断 |
|---|---|---|
| P0 基线与契约 | 分支隔离、执行链审计、领域接口、Schema、ADR 与证据记录 | P0 已签署；当前没有重新打开的基线缺陷 |
| P1 CLI 诊断闭环 | 独立于 Preview 的官方 CLI、dirty 根输入、快照／依赖失效、共享 Problems、诊断及问题工具 | 实现和主要自动化已交付；Gate P1 未闭合，最终真实 Agent 的 dirty-buffer 修复／复验／结束，以及剩余 D/S 专项证据仍须闭合 |
| P2 网格与测量 | 原始 STL/3MF、拓扑／自交／壳层、可信测量前提、冻结网格 PNG、测量工具与 artifact 生命周期 | 功能自动化和生产网格子流程有通过证据；Gate P2 未完整签署，早期候选真实 Agent 的严格场景失败，最终候选没有对应的模型 PASS |
| P3 零件与装配 | Manifest、稳定作者 ID、安全 selector、刚体变换、距离／接触／交叠／包含、五类约束和修复 Skills | 领域、官方 CLI、装配 Host／installed 子流程有通过证据；Gate P3 未闭合，路径别名缺陷修复后尚无最终真实 Agent 修复闭环 PASS |
| P4 差异与反馈 | 摘要 Diff、约束回归、持久基准、冻结证据视图、空间反馈／stale／人工重映射、显式打印筛查 | 已执行的自动化通过；Gate P4 未闭合，两场真实 Agent 未在 240 秒内完成，真人点选修复没有完成，动态工作区移除待验 |
| P5 MCP | 不开发 | 用户取消，不计欠账 |

依据：[P1 跟踪](../cad-gate-p1-followup.md)、[P2 验收](phase2-acceptance.md)、[P3 验收](phase3-acceptance.md)、[P4 验收](phase4-acceptance.md)。旧文档中“Phase 2–5 尚未实施”等语句属于当时的历史状态，以各阶段后来交付及本总览为当前判断。

## 当前证据强度

- 共有 **51 Tools / 12 Skills**，其中 CAD 业务工具 11 个。工具原生注册已经成立；各 Provider 每轮实际暴露的子集仍以请求轨迹为准，不能由 catalog 数量推断。
- 最终候选默认测试 **436 PASS / 3 SKIP**，包括 19 项 review 测试；类型、lint、生成资源、VSIX、冻结视图入口及 WebGPU/WebGL2 测试有通过证据。
- 最低支持版 1.140.0 与当次 Stable 1.146.0 完整 Host 均为 **56 PASS / 1 PENDING / 3 FAIL**。五项已执行 P4 Host 用例通过；一项动态工作区变更 pending；三个失败为原生焦点前提。
- 最终生产安装的 CAD/review 子流程通过；完整 installed 在焦点等待处失败，不能算整体通过。
- 各阶段真实 Agent 的历史失败保持原样，后续修复未重跑的最终候选不继承旧结果。当前没有可签署 P1–P4 全部闭环的统一最终候选证据。
- Windows Unicode 保持 `KNOWN_PLATFORM_GAP`；Linux、Windows、远程原生验收及完整规模／耐久压力等未运行项保持未运行。

最新结果和运行命令见 [交付记录](evidence/phase4/delivery.json)；实际包、源码与测试实例的 Hash 分开记录。上述是已有证据的核对，不是本次新执行的测试结果。

## 未闭合原因与下一步优先级

1. **先闭合内置 Agent 的真实调用流程。** P1 需要定位原生编辑保存 dirty 内容的触发源并完成第二次分析和终态回复；P2 有参数／严格 oracle 对齐问题；P3 的路径别名实现缺陷已修，但修复后的模型闭环尚未证明；P4 有比较参数误用及原生定位确认未完成。不能把这些统一归因为 CAD 几何算法失败，也不能用 Host 直接调用代替真实模型证据。
2. **完善验收宿主和人工交互的可观测性。** 原生焦点、工具确认、用户提交、模型流结束、报告发布分别记录；动态工作区变更需要可接受该操作的宿主完成直接测试。保留有限时尝试和真实失败，避免循环重试或降低断言。
3. **在同一最终 VSIX 上集中验收。** 覆盖诊断 dirty-buffer 修复、网格测量／图片、固定装配约束修复、比较／打印筛查和真人空间反馈修复；核对实际工具暴露、报告／snapshot／artifact、buffer/disk 与 Manifest/profile Hash。
4. **按依赖审阅和整合 PR，再按目标平台闭合发布门禁。** 当前 P1–P4 分别为草稿 PR #2／#3／#4／#5，均未合并。main 仍为 `8a3ff1fe394b11aeb7fb323e7319bd365d29abaa`。本次没有合并或发布。

这些工作不需要新增 MCP，也不以新增工具数量为目标。当前评估不授权再次运行此前受“单场一次”限制的真实 Agent 验收。

## 已批准的能力边界

后续分阶段计划对原 SPEC 的宽泛目标作了明确收敛，按已批准范围评估：

- P3 不计算交叠体积，不提供运动路径；复杂关系无法证明时保留 `UNRESOLVED`。
- P4 提供摘要 Diff 与约束回归；采样热力图、Boolean 差、单个零件内部的局部不变证明不在本次范围。
- 打印能力只覆盖显式 profile 下的包络与数值悬垂候选，持续标记 `printability: NOT_CHECKED`；厚度、桥接、支撑、切片和制造成功不是本轮已承诺的完成项。
- 未保存 include/use 和网格 buffer 的既有降级边界继续明确报告；不通过偷偷保存或修复网格获得 PASS。

因此，不采用缺乏任务权重依据的总体完成百分比。当前可准确表述为：**P0–P4 均已有代码交付，P0 已签署，P1–P4 的完整 Gate 仍开放；P5 已取消。**

## 2026-11-17 收尾实施入口

用户已批准新的验收收尾计划：推荐 oMLX Qwen3.6，必要时条件式 Qwen3.8 对照，单自动场景 600 秒。旧单场 240 秒限制和失败保持历史证据，本次新批次单独记录。当前问题与归因见 [收尾台账](acceptance-closeout.md)，无法可靠自动验收的交互见 [逐项手动清单](manual-acceptance.md)，D/S 范围见 [覆盖映射](closeout-coverage.md)。新脚本本身不签署任何阶段 PASS，实际新运行见 closeout evidence。
