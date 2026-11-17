# Copilot harness 验收迁移与复验记录

更新：2026-11-17。正式 Agent 验收使用 **VS Code Copilot harness / Agent Host**。Local harness 历史结果保留，不继承为当前 PASS。main 基线 `44e126a`；迁移分支 `codex/copilot-harness-acceptance`，最近执行候选 `a6e41e7`。未修改 main，未构建外部 CAD MCP。

## 实施内容

- 自动及手动入口默认 Copilot；不调用 `newLocalChat` 回退。先读取实际 Chat Model References，要求 `agent-host-copilotcli:`，不能凭配置或窗口标题确认。
- 导出实际 Chat，匹配本次 run marker 与 `agent.id=agent-host-copilotcli`。旧 Local transcript 不再作为新验收凭据。
- 选择 Agent Host 的 BYOK 条目：`vendor=agent-host-copilotcli`、`id=omlx/Qwen…`。检查实际 `resolvedModel`，发现其他模型即拒绝 PASS。
- 新证据独立写入 `evidence/copilot-harness/`。保留严格业务断言、每候选/模型/场景一次 600 秒预算、备选资格及人工确认边界。保持 51 Tools / 12 Skills。
- 新增只读真实会话探测；不读取或迁移凭据。SDK 补充证据仅投影本次临时会话的允许字段，不保存提示词、推理或凭据。

## 登录后的实际复验

用户已完成登录，最初的认证阻断已解除。三次尝试属于不同 harness 修正候选，原始失败均保留：

| 候选 / 尝试 | 实际结果 | 判定 |
|---|---|---|
| `a4d5bda` / `de51c0d5` | 7.6 秒原生认证拒绝，无业务调用 | 历史 PROVIDER_OR_HOST；登录后不再沿用为当前原因 |
| `b1563f7` / `4806bb21` | 界面选择 Qwen，但实际 `resolvedModel=gpt-6-luna`；四个 CAD 工具成功调用，40.8 秒结束 | 模型路由不合格，**不能签本地模型 PASS**；已修正选择方式 |
| `a6e41e7` / `23b7ed5b` | 真正 Qwen3.6 本地 BYOK，约 80.947 秒停在 questionCarousel；无 CAD 调用 | 自动场景未闭合；归因 UNKNOWN_OR_MULTI_FACTOR，备选不具资格 |

最终尝试的 SDK 记录：`selectedModel=omlx/Qwen3.6-35B-A3B-OptiQ-4bit`，七次 usage 的 `model/responseModel` 均为指定 Qwen，`isByok=true`、`byokKind=local_user`。因此不能再把测试窗口代理没有记录请求解释为“没有推理”。

实际工具轨迹为 `skill → bash → read_bash → bash → ask_user ×3`。模型把 CAD 工具当终端命令寻找，继而提问如何处理“missing MCP tools”。这证明本次没有完成原生工具发现；**模型措辞不能证明插件确实缺少工具，更不能成为搭建 MCP 的理由**。未自动选择答案、修改 Provider、切 Local 或用其他模型刷 PASS。

证据：

- [最终原始结果](evidence/copilot-harness/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-23b7ed5b-84f6-455e-9a8a-d792419b5a8f/result.json)、[实际 Chat Export](evidence/copilot-harness/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-23b7ed5b-84f6-455e-9a8a-d792419b5a8f/copilot-chat-export.json)。
- [本次 SDK 模型字段](evidence/copilot-harness/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-23b7ed5b-84f6-455e-9a8a-d792419b5a8f/sdk-model-evidence.json)、[补充归因](evidence/copilot-harness/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-23b7ed5b-84f6-455e-9a8a-d792419b5a8f/assessment-review.json)。原 result 的 MANUAL_REQUIRED 仅表示遇到原生提问，不足以判断根因。
- [路由不合格尝试](evidence/copilot-harness/native/mesh-Qwen3.6-35B-A3B-OptiQ-4bit-4806bb21-6020-4fb9-b149-25820aba29c1/assessment-review.json)。

## 尚未闭合及归因边界

| 项目 | 已证事实 | 未证事实 / 下一步 |
|---|---|---|
| 工具目录 / Provider 上限 | SDK 计数 129；宿主提示模型支持 128，省略 1 个。oMLX 0.1.2 源码 `options.tools.slice(0,maxToolCount)`；插件缺省值 16 | **不能把缺省 16 当本次有效值**。实际交付的名称、排序、被省略工具及 Schema 尚未捕获，需在真正 serving window 观察 |
| Agent Host 路由观测 | 宿主 `ByokLmBridgeRegistry` 从一个有模型的 renderer window 提供 BYOK，未必是发起会话的窗口；SDK 已证明推理 | 仅在临时 workspace 设置 relay baseUrl 不足。当前严格 oracle 仍要求 relay 请求，存在观测缺口；不能删掉断言或单凭 SDK 模型名签业务 PASS |
| 原生工具发现 | 本地模型用了 bash/ask_user，未用工具发现入口、未调用 CAD | 需要确认模型实际获得 `tool_search` 与 CAD 的发现协议后，才能区分模型误用、Provider 裁剪、宿主或 harness 缺陷 |
| 编辑确认 | 本轮 mesh 不需要编辑；遇到的提问不是允许的几何编辑 | 旧 `copilot_replaceString` allowlist 不能假定覆盖 Agent Host 新编辑协议，后续需按实际原生调用适配，保持精确授权 |
| 备选模型 | 未运行 | 现有证据不足以支持模型专属失败，不用 Qwen3.8 掩盖未确认的目录/观测问题 |

以上源码核对来自本机匹配的 VS Code builder 源码及 staged oMLX 插件，未修改它们。未更改用户全局设置或关闭其窗口。没有把另一模型的成功或模型自述当成当前 CAD Gate 通过。

## 门禁与后续

当前候选确定性 baseline：默认、类型、lint、资源、真实 CLI 三项、view/GPU 通过；CAD 专项 Host **22 PASS / 1 PENDING**。harness 策略测试 **11 PASS**。具体命令及退出码见 [baseline](evidence/copilot-harness/baseline.json)。这不是完整 Host、installed 或平台复验。

**Copilot 本地模型 Agent Gate 仍 OPEN。** mesh 已正式尝试但未闭合；diagnostics、assembly、comparison 在本候选下 NOT_RUN。历史 Local PASS 不迁移。其他手动交互与 Windows Unicode 状态保持不变。

继续顺序：先解决 serving-window 的真实 Schema 观测和工具目录完整性，再冻结候选并进行有界 mesh 尝试；证据支持后才作模型对照，然后执行 dirty diagnostics、固定 Manifest 装配及比较流程。手动项目在 [独立清单](manual-acceptance.md) 的 M11 先记录真实 Copilot 会话和模型，随后逐条执行其余交互。不得为了验收添加外部 CAD 服务。
