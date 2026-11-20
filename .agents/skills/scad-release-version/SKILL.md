---
name: scad-release-version
description: 分析 SCAD AI IDE 的 Git 变更和双市场发布状态，建议 Preview 或 Stable，并调用确定性的版本 CLI 生成、校验或在授权后预留 Plan。用于版本决策与预留。
---

# SCAD AI IDE 版本管理

默认执行只读分析。用户要求计划时生成本地未预留草案。只有用户明确授权远端预留时才执行 `reserve --apply`。构建、打包及市场上传属于各自的发布流程。

1. 核对当前 Git 分支、完整提交、origin、Tag 和项目 publisher。用 `npm run --silent release:version:status -- --json` 查询 Git 和双市场。尚未配置 publisher 时报告缺少已核实的市场身份。任一来源 unknown 时，将候选标记为未验证并停止预留。
2. 对照上次完成发布的提交审查 Git Diff、提交或 PR、CHANGELOG 和测试证据。将变更评为 `none`、`fix`、`feature` 或 `breaking`，说明证据和不确定性。可为 `--analysis` 准备包含 `changeLevel`、`summary`、`evidence`、`confidence`、`needsReview` 和可选 `risks` 的 JSON。
3. 用 `npm run --silent release:version:resolve -- --channel preview --change fix --json` 调用确定性分配器，按实际意图替换参数。遇到 partial、conflict 或 reserved 时，先定位冻结 Plan 和原始 VSIX 哈希，并报告恢复条件。Stable 热修复须从已发布 Stable 的维护分支取源；周期提升与 Major 切换需用户批准。命令选项见 [发布手册](../../../docs/release-system.md)。
4. 用户要求草案时，用 `release:version:plan` 指定完整 `--commit`、`--out` 和所选周期，然后以 `release:version:verify -- --plan <路径>` 校验。草案文件以 `.draft.json` 结尾。远端预留授权后，先展示 `release:version:reserve --dry-run`，再以发行 ID 确认 `--apply --confirm-release <releaseId>` 并指定冻结 Plan 输出文件。凭据由维护者在标准环境中管理。
5. 报告建议通道、变更级别、CLI 输出的候选号或预留号、证据、来源可信度、Plan 路径和待满足的条件。开发者版本决策由此 Skill 协助，npm 脚本执行确定性逻辑和显式查询。草案生成保持工作区版本和扩展贡献声明原样。
