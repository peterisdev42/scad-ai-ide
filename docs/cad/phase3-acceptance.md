# Phase 3 交付与验收

代码交付完成，**Gate P3 未闭合**。领域、官方 CLI、装配 Host 和生产安装的装配子流程通过；真实 Agent 原始失败、完整 Host／installed 的焦点失败均保留。

## 基线与交付范围

基线 `2385de712f4ea97ee0463b9316a097315b281512`；产品提交 `03891aa6af10aa72ad8299af262e9528cd83a75a`；分支 `codex/cad-parts-assembly`。依赖尚未合并的 PR #3／#2。main 保持 `8a3ff1fe394b11aeb7fb323e7319bd365d29abaa`，没有直接修改、提交、合并或发布 main。报告契约兼容补丁 `04bc39e` 为嵌入的 v2 选择上下文补充可选 Schema 字段，业务 bundle Hash 不变。交付 [草稿 PR #4](https://github.com/peterisdev42/scad-ai-ide/pull/4)，依赖 #3／#2。后续证据提交只更新本文及归档。

实现 Manifest／本地 Schema、作者稳定 ID、安全 define／整文件导出、Float64 装配变换、原始实体前提、区间距离、接触／交叠／包含／空腔分类、五类约束、v3 快照与历史报告、共享任务和独立取消、Problems／Dispatcher 命令、测量及冻结世界坐标 PNG。新增 listParts／checkAssembly，两项修复 Skill；共 **46 Tools / 9 Skills**，原有 diagnostics v1／mesh v2 入口保持兼容。详见 [架构](phase3-architecture.md)。

## 实际验证

[机器记录](evidence/phase3-2026-11-13/summary.json)、[命令及宿主环境](evidence/phase3-2026-11-13/host-runs.json) 与 [文件 Hash](evidence/phase3-2026-11-13/sha256.json) 是本次证据入口。

| 层级 | 结果与边界 |
|---|---|
| 类型、lint、生成契约 | PASS；46 Tools、9 Skills，Schema、资源及 VSIX 检查通过 |
| 默认测试 | 417 PASS / 3 既有跳过；装配专项 21 PASS，已包含在默认计数中 |
| 几何与生命周期 | 标量向外取界、0.30／0.18 对 0.25、面／边／点接触、横穿、相同实体、包含、空腔、包含体内再有空腔、非法网格、刚体变换、3MF 反射、同配对不同规则、Manifest 位置／冲突、缓存、历史、基准变化、独立／最后调用者取消、输入变化、Worker 超时与恢复 |
| 官方 CLI | PASS；项目 Library、两个参数选择、非空原始实体、体积约束与固定间隙复验、冻结组合 STL／PNG，源文件磁盘保持 0.18。见 [原始证据](evidence/phase3-2026-11-13/official/official-cli.json) |
| Extension Host | 最低 1.140.0 和执行时 Stable 1.146.0，各 **51 PASS / 3 FAIL，exit 1**。装配三项用例均通过；失败是原生 Undo／Redo 两项和 Enter 缩进一项未获得窗口焦点。完整 Host 不计 PASS |
| 别名临时工程 | 3 PASS，exit 0；`/var`／`/private/var`、规范化 Manifest、dirty SCAD／Manifest、独立 selector/include、Problems 撤销、历史 stale、嵌套工程、冻结图片 |
| 最终生产 VSIX | Schema v1/v2/v3、Manifest Schema、两个 Worker、Skills、许可证与 46 工具清单通过；Host 使用的 bundle／Worker Hash 与该 VSIX 一致 |
| installed | 装配发现失败→只改临时源参数→新快照 PASS→测量→PNG→Manifest 未变子流程通过；整套 smoke 在原生 Undo 前等待窗口焦点超时，exit 1。见 [装配子流程](evidence/phase3-2026-11-13/installed-assembly.json) 与 [完整日志](evidence/phase3-2026-11-13/installed.txt) |

Stable 版本依据执行时安装程序与 [官方 1.146 发布说明](https://code.visualstudio.com/updates/v1_146) 交叉核对。源码由同一生产归档安装，未将 Development／直接 Host 调用当作真实模型验收。

## 真实 Agent：一次失败，禁止覆盖为 PASS

**CAD-P3-AGENT-01 / FAIL；最终候选真实 Agent NOT_RUN。** 使用既有 F5 oMLX Provider 0.1.2、`Qwen3.6-35B-A3B-OptiQ-4bit`，仅一次、240 秒总预算，实际约 151 秒。原始 [oracle](evidence/phase3-2026-11-13/native/result.json)、[实际工具轨迹](evidence/phase3-2026-11-13/native/tool-traces.json)、[Provider 暴露](evidence/phase3-2026-11-13/native/tool-exposure.json) 和 [分项事实](evidence/phase3-2026-11-13/native/assessment.json) 均保留。

模型实际读取了 parts 和 checks，随后调用 checkAssembly 并携带正确 manifestDigest；内部最终复核使用规范化 `/private/var` Manifest URI，旧工作区查找只识别 `/var` 拼写，返回 `INVALID_PROJECT`。没有成功返回的装配报告、几何修改或复验。源码与 Manifest 均未改变；Provider 确实收到五个 CAD 工具 Schema，HTTP 均为 200，未提取或迁移凭据。

该运行加载的 bundle 与原候选 VSIX Hash 一致。之后已修复规范化工作区查找、诊断显示路径和 selector 依赖缓存别名，并在临时 Host 工程和最终 installed 装配子流程复验。**没有再次运行模型，也不把 Host 修复通过换成 Agent PASS。** 关闭本项需要另行授权的新真实修复验收，完整保持 Manifest、ID、变换及其他约束。

## 其他失败、限制与后续边界

- **CAD-P3-HOST-02 / ENV_FOCUS_NOT_ACQUIRED**：两个完整宿主各保留 3 项焦点失败；并非装配断言失败。需要可稳定获得焦点的桌面完成整套回归，当前不签署完整 Host Gate。
- **CAD-P3-INSTALLED-03 / ENV_FOCUS_NOT_ACQUIRED**：最终 VSIX 装配子流程通过，完整 smoke 在 fixture 第 133 行等待焦点失败。P2 同类跟踪保持开放。
- 一次默认测试在 Node 24.16 的 `cjs_lexer` 中原生崩溃。隔离 Worker 的 `execArgv`，避免继承测试进程 tsx loader 后，Worker 取消／超时及默认回归通过。[中间失败](evidence/phase3-2026-11-13/node-loader-intermediate-failure.txt) 保留，不当作产品 PASS。
- 非平面可证明分离之外的复杂退化接触、未证明的占据关系和跨阈值区间保留 UNRESOLVED。部分 3MF 多实例／冗余壳层的可信并集体积不能给出认证区间；不会直接相加或取 signed volume 的绝对值通过 volume 约束。
- 工具摘要有界；完整事实在只读报告，问题证据分页。未声明配对明确列为未检查；未计算交叠体积或装配总体积。图像只作显示证据。
- 32 零件／128 检查／512 配对／完整内存及百万顶点耐久压测、真实未信任窗口、Provider 内联消费、Linux／Windows／远程原生验收未运行；对应项不计 PASS。V8 heap 预算不是 OS RSS 硬上限。
- P1/P2 未闭合项和 Windows Unicode `KNOWN_PLATFORM_GAP` 状态不变。Phase 4 Diff／空间反馈、运动、厚度、可打印性、MCP 均未引入。
