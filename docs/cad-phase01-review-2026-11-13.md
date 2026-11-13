# Phase 0–1 修复后审查（2026-11-13）

审查基于用户批准的「Agent-Native CAD 实施计划：完整路线与首阶段落地」，修复基点 `d8290a870187b86956bbf8345628bde3a88b6cff`，功能分支 `codex/agent-native-cad-lifecycle`，PR #2。当前结论：两项 P1 实现缺陷已修复；Phase 0 基本完成，Phase 1 实现已落地但 Gate P1 尚未闭合。未修改 main，未合并或发布；Phase 2–5 不在此次交付中。

## Standards

独立复审未发现仓库规范硬性违反。原有 Data Clumps 建议已用 PreviewExecutionContext 处理。core 不引入 VS Code；候选目标文件系统探测位于 platform；草稿 Schema v1 与 TypeScript 同步增加输入证据 Hash、可选依赖解析 Hash。

## Spec

| 上轮发现 | 修复和证据 | 状态 |
| --- | --- | --- |
| 当前输入不完整仍复用旧 PASS | 缓存要求本次输入完整；inputEvidenceHash 区分输入完整性和 CLI 后续证据；current/执行前后/Preview 发布均复核。纯服务测试与真实 Host 的不可读 constraints 场景证明旧 PASS 不复活，新报告 UNRESOLVED 且保持可读 | 已修复 |
| 新增高优先级同名依赖绕过快照 | literal include/use 候选（含不存在的路径，扫描所有 resolved 依赖而不限扩展名）单独指纹与监听；原始所选依赖仍按内容 Hash。真实 Host 首次发现 nested 库并 PASS，新建根目录同名断言失败模块后旧报告失效，重新执行得到 FAIL | 已修复 |
| 路径别名可能错误 UNRESOLVED | 根与依赖来源规范化；Host 通过目录 symlink URI 打开 dirty 根后运行上述场景。根文件 symlink 沿用既有路径策略拒绝；依赖文件 symlink 相对解析不确定时保守 UNRESOLVED | 已修复/边界明确 |
| 真实 Agent 门禁 | 本轮未重新签署：历史 Native 会话原生编辑保存磁盘、dirty=false，最终回复超时；先前 bundle 不冒充本轮 bundle 的模型验收 | 未完成 |
| 完整 Host 门禁 | 最终 Stable 与最低版均 48/48 PASS；早期焦点失败、closed-link 断言前提错误和 entry.txt 夹具 use/include 错误保留为历史，不覆盖或掩盖失败 | 已通过 |

本轮 Node 回归 372 PASS、3 既有跳过（221 核心 + 26 Library + 103 Preview + 22 CAD）；真实官方 CLI 1 PASS，UI/manifest 3 PASS，类型、lint、production build 和生成资源检查通过。最终两个版本的 9 项 CAD Host 场景均通过（最低版包含在完整回归中）。新测试同时防止注释/字符串伪依赖和 CLI-derived UNRESOLVED 报告被误判为 stale。完整命令、退出码和 bundle/源码 Hash 见 [本轮机器证据](cad/evidence/2026-11-13/summary.json)。

## 按 Plan 核对

| 阶段 | 当前状态 | 未闭合事项 |
| --- | --- | --- |
| Phase 0 | 基线、分支、领域契约、Schema、架构及证据已交付 | 无新增实现缺陷 |
| Phase 1A | 共享 CLI、CSG 诊断、Trust、能力探测、超时/取消/有界输出已实现；保留 Preview/Markdown/Quick Exporter | Windows 进程树等本机无法实测的发布范围另记 |
| Phase 1B | 两项错误 PASS 缺陷已修复，缓存/导航/发布使用输入证据，补齐解析候选和 nested/alias 回归 | Runtime/Library/Override/约束切换、旧请求竞争等 D/S 专项矩阵仍需逐项补齐直接宿主证据；不能仅以纯 Hash 单测代替全部场景 |
| Phase 1C | 同一源码 Problems、多 owner、Tools、命令、Skill、报告及 Trust 已实现 | 最终候选的真实 Agent dirty-buffer 闭环未通过 |
| Gate P1 | 未通过 | 真实 Agent 与剩余专项证据（两版完整 Host 本轮均通过） |
| 跨平台发布 | KNOWN_PLATFORM_GAP | Windows Unicode；其他平台和远程宿主本轮未验收 |

独立 Standards 与 Spec 复审未发现修复后新增的错误 PASS。用户随后要求基于最终提交再做一次有界复验，仍未闭合则登记问题并继续后续开发；结果见 [Gate P1 后续跟踪](cad-gate-p1-followup.md)。未闭合验收继续保留，不能将实现修复完成解释为整个 Phase 1 已完成。历史 2026-11-12 证据保持原样。
