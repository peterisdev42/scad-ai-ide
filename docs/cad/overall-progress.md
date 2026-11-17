# Agent-Native CAD 整体进度

> 当前验收标准已改为Copilot harness。下文2026-11-17早期F5模型结果均为Local历史证据，不能用于当前Copilot Agent Gate。迁移实现及真实认证阻断见[Copilot验收记录](copilot-harness-acceptance.md)。

更新：2026-11-17。当前收尾分支 `codex/cad-acceptance-closeout`，继承 `677dc68`（Phase 4 PR #5）；产品修复 `d3586cc`，最终验收代码／harness HEAD `1d82001`。验收候选按全部源码、harness及生产资产内容Hash冻结，文档提交不改变候选。

## 当前范围

用户已取消 **Phase 5 MCP**。全部业务能力由 VS Code 插件向内置 Agent 原生注册 Tools、Skills、报告和图片，复用 Problems／Preview。不建设外部 CAD 服务、MCP 或外部访问插件。官方 CLI、Worker、本地artifact与测试用本机模型观察转发属于内部实现，不是外部 CAD 接口。

保留分阶段批准的范围：P3 无交叠体积／运动路径；P4 为摘要Diff、约束回归与空间反馈，无热力图、Boolean差或单件局部不变证明；打印只做显式profile下包络／悬垂候选，始终 `printability: NOT_CHECKED`。未保存 include/use／网格 buffer 的降级如实保留，不偷偷保存用户模型获得PASS。

## 整体判断

代码已覆盖 P0–P4，现处于集成验收收尾。**P0 已签署；P1–P4 尚不能合并签为全部 Gate PASS，P5 不计欠账。** 本批次已关闭若干原始实现／证据缺口，但手动和平台项仍开放。

| 阶段 | 当前实测与交付 | 尚未闭合 |
|---|---|---|
| P0 | 基线、领域契约、分支隔离与Schema既有签署 | 无新基线缺陷 |
| P1 | 官方CLI、dirty根读取、快照与共享Problems；本轮修复canonical/编辑器URI错位，纯服务及Host回归通过 | strict dirty原生模型修复/保存策略、复验与终态仍OPEN；本次模型场因harness关联错误中断，修脚本后未重试；D/S剩余UI组合 |
| P2 | 原始STL/3MF、拓扑/自交/壳层与测量、冻结PNG；当前Qwen3.6无Preview四工具流程PASS，约85秒 | 未运行的最大规模/平台/人工图片交付项不能继承PASS |
| P3 | 稳定作者ID、selector、刚体装配、约束；最终Qwen3.6固定Manifest间隙修复及几何复验PASS，但严格流程因漏issue/错误测量参数FAIL | Qwen3.8一次对照严格流程PASS（约587秒）；主模型FAIL保留；规模/平台等未运行项开放 |
| P4 | 摘要Diff、约束回归、持久基准、冻结视图/批注/重映射、打印筛查；最终Qwen3.6比较/打印PASS，约127秒 | 真人点选与修复、TTL/拒绝/重映射人工确认、真实动态目录移除与平台耐久 |
| P5 | 不开发 | 用户取消，不在完成率分母 |

## 最终候选证据

- **51 Tools / 12 Skills**，11个CAD工具，继续 `vscode.lm.registerTool` 原生注册；每轮实际工具子集与Schema以Provider请求为准。
- 默认测试 **446 PASS / 2 SKIP**（448项），新增8项harness测试和1项路径去重纯服务回归；类型、lint、资源生成校验、真实CLI3项、Manifest、冻结视图/GPU、AI Panel和既有Preview GPU均通过。
- 最终候选最低 **1.140.0** 完整Host **61 PASS / 1 PENDING / 0 FAIL**；Stable **1.146.0** 为 **58 PASS / 1 PENDING / 3个焦点FAIL**。上一候选两版60/1通过，但最终Stable又失败，焦点缺口保持开放，交人工M01/M02；pending为动态目录，需M06。
- 最终生产VSIX在最低及Stable的隔离安装smoke均通过。73项生产资产Hash与冻结候选一致；实际native模型为development拷贝，不能把资产一致说成installed模型会话。
- 最终Qwen3.6网格、比较两场PASS；装配几何修复PASS，但严格流程FAIL（漏证据步骤/测量参数错误），一次Qwen3.8同候选对照严格流程PASS（约587秒），不覆盖主模型FAIL。上一候选三个Qwen3.6场景PASS保留但不移用。P1早一次106秒执行被harness错误阻断，最终候选未重试/未PASS。
- 真人空间反馈、真实未信任窗口、动态目录、多平台、完整容量/断电/压力未运行的项目逐项记录；Windows Unicode继续 `KNOWN_PLATFORM_GAP`。

[机器交付与退出码](evidence/closeout/delivery.json) · [生产包绑定](evidence/closeout/archive-binding-final.json) · [详细未闭合台账](acceptance-closeout.md) · [手动验收单](manual-acceptance.md) · [D/S覆盖映射](closeout-coverage.md)。

## 模型与功能归因

新发现的URI别名错位在无模型Host中可复现，已作为产品缺陷修复。P1本次允许的原生patch实际正确，却因当前transcript不保留用户marker而被测试控制器阻断，属于harness缺陷，不能怪Qwen。P2/P4模型曾把projectRoot填成普通路径，自己改成URI后完成，属于可恢复参数偏差，另记工具提示UX改进；不是几何能力缺失。

单次超时或两个模型都失败不能证明产品缺陷；HTTP200、`ok:true`、空Problems也不证明模型或产品通过。新台账分别保存原始输出、宿主收到参数、Schema、会话、分段耗时、保存事件与Hash，证据不足默认UNKNOWN_OR_MULTI_FACTOR。

本批次F5模型场使用内置 **Local harness**；默认Copilot harness／Agent Host路径尚未验收。VS Code 1.146已宣布Local弃用，后续兼容检查记CAD-HOST-LOCAL-05／M11，仍采用原生插件API，不扩展为外部CAD访问。

## 手动交接与发布

执行 `npm run prepare:cad:manual` 后选择 **CAD Manual Acceptance + oMLX** 按F5。临时工程与M01–M11结果模板已准备，用户可逐项保存截图、报告与Hash。未执行的条目保持NOT_RUN，不以脚本模拟真人。

收尾草稿PR依赖#5/#4/#3/#2，包含继承提交，按相对677dc68的增量审阅。main本地／远端仍为 `8a3ff1fe394b11aeb7fb323e7319bd365d29abaa`；不自动合并或发布。阶段代码交付、功能自动化、模型、手动、installed和跨平台门禁分别记录，不给没有权重依据的总体百分比。

历史评估以2026-11-16的Phase4记录为基准：当时默认436/3、完整Host56/1/3、installed焦点失败及模型未闭合均真实保留。当前结果来自本次新批次，不覆写过去失败，不将未跑项变成PASS。

本轮交付草稿：[PR #6](https://github.com/peterisdev42/scad-ai-ide/pull/6)，证据提交597cd3e及后续PR链接记录提交；生产候选1d82001保持不变。[收尾增量](https://github.com/peterisdev42/scad-ai-ide/compare/677dc681965e1d640ecf606f1ed0f60d1fe492a0...codex/cad-acceptance-closeout)。
