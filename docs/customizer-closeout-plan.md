# Customizer closeout 验收计划（2026-11-11）

本次用户授权：继续验收；同一问题反复无法完成时记录并跳过。附件作为验收参考，不授权合并 main、发布或修改相邻仓库。

## Phase 0 基线

- 远程 main（`git ls-remote`，随后 fetch）：`53ec2e41a565a19ef795b8dbc7ba8b42d9b9cf70`。
- 起始 HEAD：`39a90a3`，初始 clean；包含 main 及一笔 Preview Problems 导航修复。
- 当前独立分支：`codex/customizer-closeout-20261111`；保留该已存在修复，不回滚。
- 历史 Agent / pinned CI 成功；Library run `42976767802` 失败，不能沿用旧包或旧模型 PASS。
- 本机 Apple M4 Pro / 48 GB，Provider `techopolis.omlx-copilot-chat` 0.1.2；服务 `127.0.0.1:8000/v1/models` 返回认证错误。模型 ID/revision、推理和 Native Agent 尚未验证。
- 无适用 AGENTS.md；不修改 scad-registry / openscad-cli-builder。

## 差距与动作

| Gap | 当前实现/证据 | 本轮动作 |
|---|---|---|
| WIN-01 | 既有 Windows Unicode probe、真实 Library gate；历史失败 | 保留原失败，扩充分层诊断，固定 windows-2025，保留原 gate；有条件时执行真实 CI |
| AGENT-01..03 | F5 可用 oMLX，Native harness 仍依赖 Ollama；取消探针已禁用 | 记录服务、Provider 和工具数限制；认证未就绪不启动会虚假通过的模型测试 |
| ADR12-01 | Warning 已实现，缺 native 对照 | 新增 N-01..12 合成 fixture 差分，记录 native/IDE/位置/stderr，接入 pinned workflow |
| ADR12-02 | 历史 Host/Chromium 局部通过，未有当前包 | 重跑 Host、浏览器，当前包安装冒烟；动态导航与静态差分分别记状态 |
| RELEASE-01..02 | artifact.json 是旧包 | 当前源串行检查/打包/实包清单/安装；source SHA 与工作树变化分别记录 |
| REMOTE-01 | 无本轮环境证据 | NOT RUN，限定范围 |
| UX-01 | watcher/Undo 历史局部通过，有焦点偶发记录 | 跑已有真实 Host、Chromium 和生命周期入口；失败保留后限次重试 |
| POLICY-01 | 历史报告仍可追溯 | 新增独立 ledger/evidence，不改写旧 PASS |

## 执行与停止条件

先运行 npm ci、静态检查及核心回归；随后新增有实际缺口的诊断/差分，再运行 native、Host、浏览器。构建与测试 dist 串行，最后生成固定 Production VSIX 并校验安装。每步保存命令、退出码、stdout/stderr。相同外部条件持续失败时最多两次有意义尝试，记录 BLOCKED/FAIL 后跳过，继续独立工作；不删除 gate 或将未执行记 PASS。

最终逐项填写附件 A/W/D/M/P 编号、门禁和两个完成结论。最新精确 SHA、产物 SHA256 与未提交文件 hash 分开绑定；无真实 Windows run / 指定模型 / fixed upstream 证据时保持未通过。
