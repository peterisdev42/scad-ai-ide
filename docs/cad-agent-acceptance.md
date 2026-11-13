# Agent-native CAD：Phase 0–1 交付与验收

> 下文保留 2026-11-12 初始交付历史；当前状态见 [2026-11-13 修复后审查](cad-phase01-review-2026-11-13.md)。

本次交付以 SPEC v1.2 和经确认的实施计划为范围：只建立官方 CLI/CSG 诊断闭环。Phase 2 网格/测量、Phase 3 装配/约束、Phase 4 Diff/空间反馈及 Phase 5 可选 MCP 尚未实现。CSG 的 PASS 不能解释为模型整体设计、网格或可打印性通过。

## 基线与产物

- 基线及实施前远端 main：`8a3ff1fe394b11aeb7fb323e7319bd365d29abaa`；初始工作区干净。
- 全部修改在 `codex/agent-native-cad-lifecycle`；未直接修改或提交 main，不合并、不发布。
- 环境：macOS arm64，Node 24.16.0，官方 OpenSCAD 2026.11-RC0；最低 VS Code 1.140.0、执行时 Stable 1.146.0。
- 架构、预算和兼容决策见 [架构说明](cad-verification-architecture.md)。机器证据见 [验收摘要](cad/evidence/2026-11-12/summary.json)。最终源码 HEAD 使用该文档所属提交/PR 的 HEAD；打包及真实 Agent 的实际 bundle SHA 独立记录，避免循环写入自身提交 Hash。

## 新行为与边界

两个只读工具 `scad_ai_ide_model_analyze`、`scad_ai_ide_model_getIssue` 使用已有 catalog、Dispatcher、OperationTracker 和 Agent Adapter。旧 40 项 catalog 条目逐项与基线深比较一致；现共 42 Tools、2 Instructions、6 Skills。

无需 Preview，工具可以评估 dirty 根 buffer、产生版本化不可变报告、更新既有源码 Problems，并在修改后复验。命令 `OpenSCAD: Analyze Model Diagnostics` 提供相同入口和只读报告。保存分析默认关闭，可选 `scad-ai-ide.verification.onSave=diagnostics`；普通编辑不会触发 Full Render。

`ok:true` 仅表示报告已返回。执行状态和检查状态独立；没有必需检查、输入不完整、执行失败或中断都不能得到整体 PASS。缺少、已淘汰的报告不隐式重新执行。未知单位保持 `modelUnits`。

根文件 buffer 冻结后经 stdin 交给 CLI；dirty include/use 未覆盖磁盘，报告 `UNRESOLVED` 和输入差异。CLI 依赖发现后补齐内容指纹并最多重跑一次。缓存、发布和导航前校验源码、依赖、Runtime、Library、参数和约束身份。共享任务按快照合并，订阅者独立取消。

## 验证方法与覆盖

| 风险 | 对应证据 |
| --- | --- |
| D-01–04：parser、exit=0+assert、未知符号、缺依赖 | 真实 CLI 场景、规范化诊断契约与 Host dirty 根测试 |
| D-05–06：参数文件、布尔空结果 | 既有 Preview eligibility/Exporter 回归、报告 SKIPPED/未检查契约；本阶段不声称 Full Render 非空证明 |
| D-07：路径和 Unicode | macOS 真实 CLI 中文/空格路径及参数数组测试；Windows 原生 Unicode 仍为发布缺口 |
| D-08：输出洪泛、取消和资源回收 | CLI 洪泛、有界错误保留、超时/队列/取消及恢复测试 |
| D-09–11、D-15–19：owner、include、过期发布/导航 | CAD Host 的双 root 共享 include、真实 Preview session 与 Agent、外部关闭文件修改、旧导航拒绝及 LSP 重复抑制/恢复 |
| D-12：输入身份变更 | Hash 契约、依赖变化/改后恢复、实际 Runtime wrapper 后端替换测试；Host 外部 include/dirty include 场景 |
| D-13–14：源码与视图生命周期/显式 Text | 原有 103 项 Preview Node 回归，CAD Host owner/导航测试；不承诺普通 Problems 单击强制 Text |
| S-01–05：Trust、取消、dispose、能力、失败语义 | catalog/服务/CLI 契约、Host 路径与 schema 拒绝；真实未信任窗口和跨平台进程树未在本机完整验收 |

以上是证据映射，不等同于逐条 SPEC 场景在所有平台、所有宿主形态均已通过。测试结果、未运行项及门禁状态分别记录。

## 可复现入口

在功能分支设置 `SCAD_OPENSCAD_EXECUTABLE` 为受选官方 Runtime 的可执行文件；Host/installed 测试同时设置 `SCAD_VSCODE_EXECUTABLE`。真实 CLI 命令不会接受 Mock 作为替代证据。

```sh
npm test
npm run test:agents:manifest
npm run test:agents:ui
npm run package
npm run test:cad:real
npm run test:cad:host
node scripts/verify-agent-vsix.mjs .build/scad-ai-ide-agent-cad.vsix
node scripts/test-agent-installed.mjs .build/scad-ai-ide-agent-cad.vsix
```

完整 Host 可使用 `.vscode-test.mjs` 的 `SCAD_TEST_WORKSPACE`、`SCAD_TEST_USER_DATA` 指向预先建立的隔离目录；仅受控临时工作区设置 `SCAD_TEST_TRUSTED_FIXTURE=1`。真实 Preview/Markdown 还需 `SCAD_TEST_OPENSCAD` 和 `SCAD_PREVIEW_EXPORTER`。原有原生输入/Undo 测试需要测试窗口获得系统焦点，不能同时运行多个争夺焦点的 GUI 验收。

真实 Agent 使用 `node scripts/test-cad-native.mjs`，复用 F5 的 oMLX Provider 和 SecretStorage；不会提取凭据。Native Local Chat 接受附加的实际 debugging Skill，调用真实工具并通过原生编辑工具修复。本次用户明确授权的临时 fixture 编辑仅 `width=0;` → `width=1;`，保留 assert/cube、不保存。测试控制器验证完整 buffer 的唯一差异后点击原生确认；`SCAD_NATIVE_FIXTURE_EDIT_APPROVED=width-0-to-1` 只是记录这次先前人工授权的测试标记，不属于产品权限机制，不能当成未授权会话的自动批准。其他编辑和 SourceApply 不在本次授权内。

Provider 实际收到的工具 Schema 名称/Hash、原生 transcript、Dispatcher 调用、Problems、buffer/disk Hash 与最终回复分别采集。`chat.saveBeforeSend=false`、`files.autoSave=off`。测试不打开 Preview、不构造模型回复、不由控制器代替模型调用分析工具。Native 开发宿主与 Production installed VSIX 验收分别报告。

## 发布门禁与未完成项

功能、真实 Agent、跨平台发布分别签署。Windows Unicode 保持 `KNOWN_PLATFORM_GAP`，不能签署跨平台发布 PASS。Linux、Windows、Remote-SSH、WSL、Dev Container 的实际宿主未在本机执行；CI 已保留旧原生门禁并新增 CAD 真实 CLI 检查，没有用跳过旧失败替代修复。

报告/日志为本机有界内存缓存（128 项、TTL 30 分钟、16 MiB），扩展重启后失效；尚无持久历史库。第一版不覆盖未保存依赖，不提供 verify/测量/空间证据等未实现参数。后续阶段按架构文档路线推进。

## 本次签署结果

| 门禁 | 结果 |
| --- | --- |
| P0 | PASS：基线、功能分支、契约及架构记录成立 |
| P1 实现与功能验收 | 实现已交付，验收未全部通过：Node 369 PASS / 3 既有跳过；两版最终 CAD Host 各 7 PASS；完整 Host 两版各 43 PASS / 3 FAIL，失败均为原生窗口焦点前提 |
| 真实 Agent | NOT_PASS：oMLX 真实调用 FAIL→PASS，Problems 撤销；原生编辑实际保存临时磁盘，最终回复超时，不能声明 dirty buffer E2E 通过 |
| Production installed | 最终 VSIX 完整 smoke PASS，包括真实 CAD、既有 SourceApply、原生 Undo/Redo 和 Preset；早期焦点失败保留在证据中 |
| 跨平台发布 | KNOWN_PLATFORM_GAP：Windows Unicode；其他平台/远程形态本机未执行 |

最后一次 Native 使用 F5 已配置的 oMLX Provider 0.1.2、Qwen3.8-27B-4bit，保持 Save Before Send/Auto Save 关闭。工具调用与授权编辑均真实发生；最后 buffer 与磁盘 Hash 相同，dirty=false，这项失败不能由恢复磁盘、修改 oracle 或重命名通过状态来掩盖。之前 Qwen3.6 的最终回复同样未正常结束。原生编辑行为与服务读取 dirty buffer 的能力分别记录，后者已有 Host/installed 证据。

最后的 Preview 兼容修复确保共享管线拒绝过期结果时，不回退旧 buffer-only Problems 通道；追加断言并重跑 Node、类型/lint/build、真实 CLI 和两版 CAD Host。Native 实际测试 bundle 与最终候选 bundle 的 Hash 分别记录，不冒充最终版本的完整模型验收。交付为草稿 PR，P1 的完整签署及发布门禁仍开放。
