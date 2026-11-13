# Phase 2 delivery and acceptance

实现已落地，**整体 Gate P2 尚未完整签署**。功能自动化通过；真实 Agent 严格场景失败，最终 installed 总流程另有原生焦点缺口。失败没有通过放宽断言或反复重跑改成 PASS。

## 基线与交付

- 基线：`3e3628a12eeb64699815224a6a96221e1aa49c62`。
- 功能分支：`codex/cad-mesh-measurements`；最终产品代码：`d43e3285d58d85fba764846f02f4a79c5dcadd24`。后续提交只补测试、CI、文档和证据。
- main 保持 `8a3ff1fe394b11aeb7fb323e7319bd365d29abaa`。没有在 main 修改或提交，没有合并或发布。
- 依赖 [P1 草稿 PR #2](https://github.com/peterisdev42/scad-ai-ide/pull/2)；P2 草稿 PR 创建后在本文件补链接。面向 main 的 PR 包含 P1 依赖提交，P2 审查应从 `3e3628a` 比较。
- 归档：`.build/scad-ai-ide-phase2.vsix`，SHA256 `06807da7b608a06d9277474b48a8c93a831e723c8061eadfc24a5454a12d7fe8`。它是本轮实际安装验证的归档，不承诺发布。

## P2A–P2D 完成范围

| 切片 | 已实现 | 证据 |
|---|---|---|
| P2A | v2 快照/报告；独立网格字节冻结；共享/独立取消；输入前后复核；原子、Hash、TTL、租约和容量保护；超大报告不返回 PASS | `mesh/service.test.ts`、`artifacts.test.ts`，最终 Node/Host 记录 |
| P2B | 原始 ASCII/binary STL；3MF 包关系、Core 对象/组件/build、单位、嵌套/反射变换；有界 ZIP/XML、循环和损坏检查；独立 Worker | `geometry.test.ts`、`format.test.ts`、`worker.test.ts`；带 SHA256 的 golden fixtures |
| P2C | 精确坐标拓扑、非流形顶点/边、绕序、退化/重复面、BVH/自适应谓词、自交/接触、壳层/空腔、补偿求和和可信体积前提 | 黄金盒体/空腔/反绕序/开放/交叠/数值/预算用例；官方 CLI SCAD/CSG 实证 |
| P2D | analyze verify、measure、renderViews、扩展 getIssue；有界原始三角坐标/组件证据；共享 Problems；只读报告/PNG；新 Skill；44 Tools/7 Skills | 两版 Host，Provider 实际暴露记录，最终 VSIX 和生产网格子流程 |

原 Preview 的 Manifold Worker 保留；原始缺陷验证不调用它。3MF 多壳实例组合、近接触和无法证明的实体关系保守返回 UNRESOLVED。图片使用冻结显示 STL，保存原始/显示 Hash 和 Float32 显示误差；它不改变原始 Float64 结论。

## 最终自动化结果

最终产品代码 `d43e328` 的实际命令、退出码、环境和日志 Hash 见 [机器汇总](evidence/phase2-2026-11-13/summary.json)、[Node](evidence/phase2-2026-11-13/node-runs.json) 和 [Host](evidence/phase2-2026-11-13/host-runs.json)。

| 检查 | 结果 |
|---|---|
| `check-types`、`lint`、`check:agents` | 各 exit 0 |
| `npm test` | 396 PASS / 3 既有跳过，exit 0；其中网格专项 23 PASS |
| Agent LF/CRLF manifest | 2 PASS |
| Customizer compatibility | 42 PASS |
| 官方 CLI + Worker + PNG | 1 PASS；盒体体积 24、空腔 26、CSG 再导出、两档细分、空模型及冻结图像 Hash |
| 完整 Extension Host，1.140.0 | 51/51，exit 0 |
| 完整 Extension Host，Stable 1.146.0 | 51/51，exit 0 |
| VSIX 资源校验 | 44 Tools / 7 Skills，v1/v2 Schema、独立 Worker、第三方许可证均存在 |
| 最终 Production installed | **exit 1**；网格子流程通过，随后原生窗口未取得焦点，未完成后续 Undo 检查 |

Stable 版本另由 [官方更新接口](https://update.code.visualstudio.com/api/update/darwin-arm64/stable/latest) 在执行时核对。机器证据保存实际平台、Node、官方 Runtime 路径与版本。CLI 的 [真实 STL/PNG](evidence/phase2-2026-11-13/official/) 可复核；源码夹具和 golden Hash 清单在 `src/test/mesh/golden/`。

[过程失败](evidence/phase2-2026-11-13/intermediate-runs.json) 另行保留，包括开发期依赖通知取消、旧 schema 断言、Problems 生命周期和焦点问题。最终通过项仅覆盖对应最终产品代码的执行，不替代未运行场景。

## 真实 Agent：一次尝试，失败保留

状态：**CAD-P2-AGENT-01 / FAIL**。使用既有 F5 oMLX Provider 0.1.2、`Qwen3.6-35B-A3B-OptiQ-4bit`，总限时 240 秒，实际约 134 秒；仅一次场景尝试。凭据未提取或迁移。

场景在候选 `f823678` 上运行，**不是最终产品 bundle**。Agent 实际完成 verify → measure → getIssue → renderViews，四次成功调用使用同一 reportId/snapshotId，负 signedVolume=-1，physicalVolume 为 UNRESOLVED/null，单位 modelUnits。源文件未修改，图像 Hash 对应冻结网格，Provider 确实收到四个工具 Schema。

严格 oracle 要求 `cameras=["iso"]`；Agent 最终省略相机参数，触发合法默认的三视角，原 harness 因 `3 !== 1` 判失败。其间模型还有原生宿主 Schema 校验后的参数重构；没有由测试控制器另开场景重试。原始 `pass:false` 保持不变；[事后分项事实](evidence/phase2-2026-11-13/native/assessment.json) 不覆盖原始 oracle。后续产品修复后不再重放本场景，最终候选真实 Agent 为 NOT_RUN，不能继承这个早期候选的 PASS。

关闭条件：另行授权的新验收中，模型按请求构造参数、保持全部证据一致，并正常结束；本次不签署真实 Agent Gate。

## 最终 installed 焦点缺口

状态：**CAD-P2-INSTALLED-02 / ENV_FOCUS_NOT_ACQUIRED**。

最终归档的验证、测量、冻结 PNG 和只读 artifact 读取已在生产安装宿主执行并完成断言，[网格子流程证据](evidence/phase2-2026-11-13/installed-mesh.json) 保留。之后既有 smoke 在 `test.cjs:120` 等待 `vscode.window.state.focused` 超时，发生在 Undo 执行前。实际 [exit 1](evidence/phase2-2026-11-13/installed-run.json) 和 [栈](evidence/phase2-2026-11-13/installed-failure.txt) 保留；不把子流程通过写成整个 installed PASS。旧候选 installed 曾通过，其结果不能替代最终归档。

关闭条件：在可稳定获得焦点的受控桌面重新完成整个生产 smoke。当前记录问题，不循环重试。

## 未运行与继续开发边界

- Linux、Windows、远程宿主原生验收未运行；Windows Unicode 保持 KNOWN_PLATFORM_GAP。CI 已增加网格矩阵入口，配置不代表执行通过。
- 完整 128/256/512 MiB 和百万顶点耐久/RSS 压测未运行；边界、容量、超时、取消、恢复、候选预算和内联回退已有较小夹具验证。V8 heap 不是完整 RSS 硬上限。
- 实际未信任窗口与 Provider 内联图像消费未运行；Dispatcher/服务 Trust 拒绝、Host 原生 DataPart、无 API/载荷回退已经验证。
- P1 的 CAD-P1-AGENT-01、CAD-P1-AGENT-02、CAD-P1-COVERAGE-03 和发布缺口保持原状态，见 [原跟踪](../cad-gate-p1-followup.md)。本轮没有重试或签署 P1。
- Phase 3 的零件身份、装配间隙、约束、Diff、厚度与可打印性均未实现，也未计 PASS。

功能自动化与生产网格子流程可供后续开发承接；完整 Gate P2、真实 Agent Gate 和跨平台发布 Gate 均不冒充已闭合。
