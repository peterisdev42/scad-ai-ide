# Gate P1 后续跟踪

2026-11-13，按用户要求，基于最终修复提交 `22a6caa4ba918fde2f397a2d25197288c58b1b3f` 重建并仅做一次 240 秒真实 F5/oMLX 验收。加载的 bundle SHA 与重建产物一致。结果仍未闭合；按用户安排停止重试，登记问题后继续后续开发。Gate P1 不签署 PASS；后续功能开发可以承接此代码基线，验收缺口继续独立跟踪。未合并或发布。

[本轮机器证据](cad/evidence/2026-11-13-final-reaccept/summary.json)记录实际命令、退出码、模型、调用轨迹、审批、buffer/disk Hash 和观测状态。使用 VS Code 1.146.0、oMLX Provider 0.1.2、Qwen3.8-27B-4bit；Auto Save=off、Save Before Send=false。仅授权临时 fixture 的 width=0→1，未修改用户模型或产品代码。

## 本轮结果

- 首次真实 `cad.modelAnalyze` 返回预期 FAIL，检出断言；reportId=`cad-ef33f61d-8de2-4c40-90d3-a107eaba9af6`。
- 原生编辑获授权并将 width 改为 1，保留 assert/cube；观测时 dirty=false，磁盘包含原先未保存的标记和修改后的源码，buffer/disk Hash 相同。
- 在 240 秒预算内没有观察到第二次分析或最终回复；脚本 exit=1、pass=false。模型请求 HTTP 200 不代表整轮完成。
- 编辑后 Problems 已失效撤销，不能用空 Problems 宣称修复验证通过。此次没有新的 PASS 报告。
- 本轮只说明没有在该预算内完成，不推断流程永远无法完成。保存触发源和终态未完成的根因尚未定位。

## CAD-P1-AGENT-01：原生编辑保存未保存内容

状态：OPEN / DEFERRED，Gate P1 阻断项。

预期：根 buffer 维持 dirty，磁盘与 fixture 初始内容一致，在不保存的情况下完成再次分析。实际：原生编辑后 dirty=false，磁盘被更新；该现象在最终修复提交上再次观察到。CAD 服务读取 dirty buffer 的能力已由 Host/installed 验证，不能将此链路问题直接归因于领域服务。

后续定位：记录 onDidSaveTextDocument 与原生编辑/Chat editing session 的时间顺序，确定保存调用源；不要通过恢复磁盘或放宽 oracle 将失败改成 PASS。关闭条件：最终候选真实 Agent 完成 FAIL→宿主编辑→PASS，且仍 dirty、磁盘不变、约束保留。

## CAD-P1-AGENT-02：时限内未完成复验与终态回复

状态：OPEN / DEFERRED，Gate P1 阻断项。

实际：一次 CAD 诊断和一次编辑完成，未观察到第二次 CAD 调用与最终回复。尚未区分模型生成、Provider 流式响应或原生 Chat 终态观测的影响。

后续定位：对齐模型请求起止、流结束、工具调用与 Chat terminal 事件；按实测延迟确定预算。关闭条件：取得真实第二次报告与不同快照、当前 Problems 正确撤销，并正常结束回复；报告明确 CSG 范围与未检查项。

## CAD-P1-COVERAGE-03：D/S 专项宿主证据缺口

状态：NOT_RUN / DEFERRED，证据缺口，不记为产品失败。

后续补齐 Runtime/Library/Override/约束切换对缓存、旧任务和导航的影响，以及真实未信任窗口等剩余专项。已有 Node 372 PASS / 3 跳过、两版完整 Host 各 48 PASS、最终 installed smoke PASS 保持其原有证据范围，不替代这些专项。关闭时逐项关联用例、命令、退出码与产物。

## CAD-RELEASE-01：跨平台发布门禁

状态：KNOWN_PLATFORM_GAP / NOT_RUN，与功能 Gate 分开。

Windows Unicode 既有缺口保持开放；其他平台与远程宿主没有本轮原生验收证据。后续开发不继承跨平台发布 PASS。

## 交接边界

两项错误 PASS 的实现修复已完成。本轮仅登记未闭合验收，不重新打开这些已修复代码缺陷。Phase 0 基本完成，Phase 1 实现已落地但 Gate P1 未通过；Phase 2–5 尚未实施。下一阶段开发保留上述跟踪编号与证据，分别签署功能、真实 Agent 和发布门禁。
