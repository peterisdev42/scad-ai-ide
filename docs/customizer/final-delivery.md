# SCAD AI IDE Customizer 最终交接报告

日期：2026-11-10。状态：**暂停交接；完整 SPEC 尚未验收通过**。没有合并 main；本次整理没有启动新的模型测试。

## 停止与版本边界

已检查此前测试会话均已退出，模型驱动和隔离 Native Agent 宿主进程扫描为空；保留用户的 Ollama 服务。所有已取得结果均保存，包括失败、超时、控制器中断和不完整观测。

最后一个验证过的产品源码版本：`64a64f3ce667d96911233d6cfe07a08316ef06e8`。基准 main：`4463d61046d962a3f5afa5ace49b21f37e6cc4a6`。这里的“验证过”指下表明确范围的回归通过，不代表全部模型或 SPEC 通过。

选定安装包：[scad-ai-ide-validated-64a64f3.vsix](../../.build/scad-ai-ide-validated-64a64f3.vsix)，4,533,358 bytes，SHA256 `242c5671cf6fa6e1703f3c0690f4fb8006d211ca3014f322cb3ba26573159f03`。实包内 40 工具、2 Instructions、5 Skills 已核对；产品源码、catalog 和打包资源与该基线一致。[产物清单](artifact.json)、[实包复核](evidence/delivery-artifact-verification.json)。

后续条件 Schema 候选包 SHA256 `4793d7b4e4c6cc96bb130f24cdd3b84dca6b29a1f8351ee444f06238408bc4c5` 单独隔离。它的局部成功不计入上述产品基线。最新 nested-kind Schema 草稿仅有 Node 35 项通过，未打包、未做 Host 或模型验收。

## 已完成的架构与功能

Phase 0 / 0.5 已完成：[架构审计](../customizer-audit.md)、[目标架构 ADR 与逐模块决策](../customizer-architecture-adr.md)。用户批准职责重组方案 B，以及后续 ADR10、ADR11 的行为变更。内部架构按下列职责组织：

| 决策 | 已实施职责 |
|---|---|
| KEEP | 工具名称、既有诊断 code、Preset 文件格式、源码默认值与未保存语义 |
| REFACTOR | 扫描器、Literal/Annotation/Model、声明与有效约束、共享领域状态及生命周期 |
| REPLACE | Preview 独立写入路径、Preset 残留 overrides 合并、未关联身份的 Quick Fix |
| DELETE | 重复的变更器与绕开领域服务的写入路径 |
| NEW | 结构化验证、源码安全事务、不可重放快照拒绝、SourceApply continuation |

逐模块清单以 ADR 为准。Phase 1–3 主体已实施：

- 统一语法发现、注释和约束；输入校验、规范化、截断与越界职责分开。校正上游 StringParameter maximumSize 遮蔽与 UTF-8 import 截断事实；IDE 不静默截断，也未宣称官方会扩大文本长度。
- 8 类稳定诊断及 4 类安全修复；将源合法性、契约、质量和 expectations 结果分离。分析不完整时保留旧状态并明确限制操作。
- 编辑器 Quick Fix 与 Agent 共用事务基础，但分别授权：编辑器保留可写工作区外/untitled/untrusted 文档能力；Agent 要求 canonical workspace、Trust、版本/hash、120 秒 TTL、一次消费和确认。
- Preset 采用 defaults＋当前集，覆盖 A→B→Default；未知版本保留原始数据并只读分析，未经验证不得应用或覆写。保存当前快照先验证可重放性，拒绝时文件、状态和源码不变。
- GUI 与 Preview 使用同一领域服务与约束；文件写入采用串行比较、stage/rename。没有声称消除跨进程最终比较与写入间的竞争窗口。
- ADR11 仅成功 Plan 返回实际工具名及实际 planId 的 continuation；requiresReview 不构成授权。Commit 严格 Schema、确认、Trust、CAS、TTL 和一次消费均保留。

Phase 4 已取得真实 Host、Chromium、原生 CLI、部分 Qt、安装包和生命周期证据；模型及部分平台验收仍未通过。

## PASS：已执行的验证

| 范围 | 结果与证据 |
|---|---|
| 整理后重新构建 | `npm run compile` PASS，见 [日志](evidence/delivery-compile.txt) |
| 整理后基线回归 | `npm test`：core 216 PASS；Preview 99 PASS；Library 26 PASS / 3 SKIP，见 [日志](evidence/delivery-regression.txt) |
| 架构检查 | `npm run check:customizer:architecture` PASS；14 core 文件、无运行时环或 Host 依赖；不以文件/行数增长证明质量 |
| 打包检查 | `node scripts/verify-agent-vsix.mjs .build/scad-ai-ide-validated-64a64f3.vsix` PASS，40/2/5，资源与恢复后的源码一致 |
| 最低 Host 与浏览器 | 同一产品基线已有实际 VS Code 1.140 Host 34 PASS、Chromium 41 PASS：[Host](evidence/adr11-host34.txt)、[浏览器](evidence/adr11-browser41.txt)；本次未重跑 |
| 安装包 | Production 安装后真实注册 LM Plan/continuation 与 Preset 快照 smoke PASS：[安装证据](evidence/installed-adr11-continuation.txt) |
| 安全事务 | 基线 capability 32 项及 Host 覆盖取消、伪造字段、过期、重复、源码变化、撤销信任等拒绝路径；不会因 continuation 放宽入参 |
| pinned Linux CLI | 上游 `bcf45a22caa954ca56ca287994cb6dbc368c67b2` 实编译 HEADLESS/NULLGL + CGAL/Manifold/experimental；41 schema MATCH＋10 import PASS；运行 42766900749，包/二进制哈希核对见 [记录](evidence/pinned-33229d6/artifact-verification.json) |
| 原生桌面 | OpenSCAD 2026.11.06 a81e8630 实际 Qt 12 检查 PASS，相关 Customizer 源码对齐 pinned；buffer/disk 与偏好校验不变：[范围与差异](native-gui-validation.md) |
| 生命周期 | 实际 Host 中 5 服务经 6 轮、每轮 32 文档及 watcher，实例 0→1→0，dispose 后缓存/订阅释放；不是全 renderer/GPU 内存验收：[报告](lifecycle-validation.md) |
| CI | 64a64f3 Agent 运行 42768676661 四个 job 成功；Libraries 42768676492 Linux/macOS 成功，Windows 失败如下 |

历史中间失败仍保留：Host 30/4 中三项来自测试 profile 错误关闭 LSP，一项 Preset watcher 竞争已修正；33/1 原生 Undo 多空行后整套 34 PASS，但偶发输入问题根因未确认。不得把复测通过描述为已证明全部根因修复。

## FAIL、INVALID、SKIP 与 NOT RUN

| 状态 | 未通过项与影响 |
|---|---|
| **FAIL** | Windows 真实 Library Unicode include：CI 26 PASS / 1 FAIL / 2 SKIP；绝对/相对/junction 方案仍失败或崩溃，未以跳过掩盖 |
| **FAIL / PARTIAL** | qwen3.5:2b-mlx 实际调用但完整任务未达标；存在缺少 Apply/Validate、虚假完成说明、错误 slider 建议。MODEL-04 目标负例调用未执行；控制器拒绝预算中断单列 |
| **FAIL：未完成** | 基线 mimo Author、Tail 15 分钟观察截止，源码未变；不能视为正常完成或工具修复成功 |
| **INVALID TEST** | 基线 cancellation 观察器首条路径 Skip、另一条却 Allow，故取消证据无效。未观察到源码改变，不能据此认定产品绕过确认。本次已在脚本启动前禁用此探针，两种入口均验证拒绝：[证据](evidence/delivery-cancellation-guard.json) |
| **FAIL：模型协议** | 条件候选 thinking-off Author 的两次 Validate 实际 semanticPass=false，但模型声称全部通过；取消候选四次 Skip 后仍重试，未遵守停止要求 |
| **INCOMPLETE / ERROR** | 条件候选 Tail 观察器未处理 Continue/Pause 界面，buffer 状态未知；Failure 达确认预算中断。均未计 PASS |
| **SKIP** | 本次 Library 默认入口 3 项跳过，未提供对应 native CLI/Exporter/online 条件；CI Windows 显式 POSIX 跳过及 Library 2 项跳过保留在各日志，未合并成一个总数 |
| **NOT RUN** | Remote SSH / WSL / Container；精确 pinned Qt 完整 GUI；各平台/样式所有控件及 slider 拖动；完整 renderer/GPU/所有 provider heap |
| **NOT RUN** | 最新 nested-kind 草稿的 Host、VSIX、真实模型；候选包的完整 Host 34 与浏览器 41 重验。完整 SPEC 最终验收未完成 |

真实 Qt 已显示与 IDE 的有意差异：文本 GUI UTF-16 截断和 import UTF-8 截断不同；off-grid 源值可能显示 10 而 runtime 为 12，真实 ArrowRight 到 15。IDE 采用已批准的非破坏校验/交互增量策略，未将 GUI 显示等同于源码运行值。

## 模型成功率与最终完成情况分开记录

以下分母仅为观察到的 Customizer dispatcher 返回，不含内置工具及进入 dispatcher 前的 Schema 拒绝；未知拒绝次数保留 null。`ok=true` 不代表 `semanticPass=true`。mimo 是本地标签，元数据实际报告 qwen3_5 9.4B nvfp4 MLX，不能据标签推断官方模型身份。

| 版本/场景 | dispatcher ok/total | 最终任务 |
|---|---:|---|
| 基线 Author | 2/3 | 截止未完成，无成功 Commit |
| 基线 Tail | 6/10 | 截止未完成 |
| 基线 Expression | 2/2 | 正常返回、未改源码；Validate 负例 semanticPass=false，不能算全任务通过 |
| 基线 Failure | 2/3 | 包含预期 OUTSIDE_WORKSPACE；正常返回，目标负例不等于编辑完成 |
| 基线 Cancel | 3/5 | 控制器 INVALID，不能验收取消 |
| 隔离候选、默认 thinking Author | 5/5 | **局部 PASS**：实际 Plan→Commit→Validate，三目标 matched，semanticPass=true；dirty buffer、disk 原样。仅此候选版本 |
| 隔离候选、thinking-off Author | 5/5 | **FAIL**：两次 semanticPass=false 却声称成功 |
| 隔离候选、thinking-off Tail | 1/9 | 观察控制器 ERROR，buffer 未知 |
| 隔离候选、thinking-off Expression | 2/2 | 狭义负例行为 PASS；未折叠表达式、未误称语法错误 |
| 隔离候选、thinking-off Failure | 12/14 | 预算中断，未完成 |
| 隔离候选、thinking-off Cancel | 9/9 | 四次合法 Commit 请求均由 UI Skip，无 Commit dispatch、源码原样；拒绝后重试导致协议 FAIL |

[机器可读指标](evidence/final-model-results.json)及对应各运行目录保存原始输入、response、trace、结果和复核；候选 Author 的独立三目标及 geometry 保留复核在其 review.json。更早 qwen/mimo 历史记录见 [模型验收](model-acceptance.md)，不覆盖旧失败。

## 未提交改动的处置与恢复边界

未验收的源码、catalog、Skill、Schema fixtures、测试驱动与 ADR 草稿已从工作树隔离，保留于 [.build/delivery-isolation-2026-11-10](../../.build/delivery-isolation-2026-11-10/README.md)：完整 tracked patch、可读 files 副本、3 个 VSIX、359 份历史日志、45 个模型运行目录的可用证据。该目录被 Git 忽略，属于本机交接材料；仓库证据目录另保留可审阅结果。

产品 `src/`、`package.json`、`skills/` 相对 64a64f3 无差异。唯一保留的测试脚本变更是启动前禁用已知无效 cancellation 探针，不改变产品安装包。其余新增改动为报告、证据和索引。隔离清单及哈希见 [索引](evidence/delivery-isolation-index.json)。恢复须先审阅 patch，并在独立分支验证；本报告不授权自动恢复或继续模型测试。

剩余工作：修复 Windows Unicode include；修复并重新验收取消观察器；决定候选 Schema 是否采纳并补完整 Host/浏览器/模型验收；补齐上述 NOT RUN。原始目标继续暂停，不能标记完成。
