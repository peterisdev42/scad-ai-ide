# CAD 手动逐项验收单

> 按 [Codex 原生 Agent 验收 SPEC](../agent-codex-acceptance-spec.md) 优先使用 **GPT-6.2 Sol（Low）**，目录缺少时使用 **GPT-6.1 Sol（Low）**。先完成 M11a，记录实际模型、等级和会话。

所有条目初始为 **NOT_RUN**。本单专门记录必须由真人操作、或当前宿主自动化无法可靠执行的交互，不以自动点击、模拟 adapter 或模型回复代签。用户逐条填结果即可；失败请保留窗口和原始证据，不需要先判断归谁修。

每个子项独立填写 `MANUAL_PASS / FAIL / BLOCKED / NOT_RUN`，不合并为整组 PASS。需要模型时使用指定的 Codex 会话。纯 UI 操作不需要模型。

## 当前优先级

| 项目 | 当前处理方式 |
|---|---|
| M03–M07 | 仍需真人点选、确认、动态目录与真正Restricted Mode；当前NOT_RUN |
| M08 | 原生DataPart的Host类型/回退已有自动化；Provider实际图像可见性与真人观察单独记录 |
| M09–M10 | 需目标平台/隔离测试环境；当前Windows Unicode缺口、其他未运行项保持原状态 |
| M11 | 在 VS Code 1.146.0 使用 GPT-6.1 Sol（Low）完成只读探测、网格和装配。其他宿主的手动签署仍待验证。见 [Codex 运行记录](../agent-codex-acceptance-spec.md#本轮运行记录)。 |
| M01–M02 | 本轮最低版与 Stable 均有 3 项窗口焦点失败。需真人核对键盘交互。 |

勾选表示实际执行，不能仅因对应自动用例通过就勾成“真人已验”。

## 一次准备

1. 在本分支完成自动 baseline 后执行 `npm run prepare:cad:manual`。终端输出临时目录、fixture.json、workspace 和 `launchArgs`。旧目录保留；每次准备生成新目录，不覆盖历史。源码均在 `.build/cad-manual/<时间>/`。
2. 在仓库根目录执行下方命令打开夹具。该命令使用当前冻结构建。要验收 VSIX 安装，应另在隔离测试配置中安装本轮 VSIX，并打开同一临时 workspace，明确记录是 development 还是 installed。
3. 记录 VS Code 版本、extension/VSIX Hash、Provider 版本、模型准确 ID，以及 fixture.json 中 candidateId 和源/Manifest/profile Hash。最低支持版和当次 Stable 分别填，不能跨版本代签。
4. 除 M07，确认是受信任临时工作区；Save Before Send=false、Auto Save=off。选择已有官方 Runtime。关闭 Preview 后开始无 Panel 用例。不要向记录中粘贴 API key。
5. 手动记录放 `docs/cad/evidence/closeout/manual/<case>-<时间>/`：截图、原生 Chat 导出、真实报告 JSON/ID、Hash、操作步骤和观察结果。最少保存下方模板，不伪造机器事件。临时文件允许按各项目指定范围修改；Manifest/约束/profile 默认逐字不动。

从仓库根目录启动：

```bash
node scripts/prepare-codex-dev.mjs
node scripts/run-codex-dev.mjs 9236 .build/cad-manual/current/manual.code-workspace
```

## 结果模板（每个子项复制一次）

```text
case/subcase:
date/operator:
result: NOT_RUN
candidateId / source HEAD / VSIX or bundle SHA:
development or installed / VS Code / OS / remote context:
Provider version / exact model ID (or not used):
fixture directory / initial source, Manifest, profile hashes:
steps actually performed:
expected:
actual:
reportId / snapshotId / feedbackId / requestId / recordRevision:
final buffer hash / disk hash / Manifest and profile hashes:
evidence files:
classification: UNKNOWN_OR_MULTI_FACTOR
confidence / competing explanations:
related issue / next action:
```

每个小项执行后将 `- [ ]` 改 `- [x]` 并链接记录（无论 PASS 或 FAIL 都代表“已执行”，状态必须另填）。没有原生 trace 时标“该层不可观测”，不可补写模型调用。UI 通过不是 model PASS；人工完成模型漏掉的工具调用，标注 assisted，模型 Gate 仍未过。

## M01：原生 Undo / Redo、Preview/源码所有权

目的：CAD-P4-HOST-01；D-09/D-13/D-14/D-19。不要用 extension API applyEdit 代替键盘 Undo。

- [ ] **M01a Text**：打开 project-a/syntax.scad，以键盘改 cube(1)→cube(2)；原生 Undo 恢复1，Redo恢复2。预期每次只改变相应编辑，不丢字符；记录实际焦点、截图及文本。
- [ ] **M01b Customizer**：在 model.scad 用正常 Preview/Customizer 修改 hole，回到 Text 原生 Undo/Redo。预期正文/参数/UI 一致，不生成无关保存；若焦点未到编辑器，先记录并手动点击再做第二个独立观察，不能抹掉第一次。
- [ ] **M01c 所有权**：在 dirty.scad 分析出 assert 问题，打开两个 Preview 与 Agent 无 Panel 分析；关闭一个、切 Text→Preview→Text、再关 Webview。预期同语义问题不重复，其他有效 owner 保留；视图错误按视图生命周期清理。
- [ ] **M01d 导航**：从错误的显式 “Preview: open source at this error” 跳到 Text 正确行；随后改源或删除临时依赖再触发旧导航。预期旧导航被拒绝／降级，不跳其他 root，不伪造位置。普通 Problem 点击不要求等同显式命令。

允许修改临时 source；记录前后内容。完整 Host 的历史焦点 FAIL 不因 M01 通过变 automated PASS。

## M02：原生 Enter 缩进（逐上下文）

目的：区分焦点/键盘路由、LSP 和产品缩进错误。初始打开 syntax.scad，先记录 language mode 与 indent 配置，必要时为 LSP 分项启用，不能混淆。

- [ ] **M02a 默认文本**：在 `{` 后按 Enter，观察正常块缩进；原生 Undo/Redo保持输入一致。
- [ ] **M02b Preview→Text**：由 Preview 显式回源码，再按 Enter；确认真实插入位置与缩进，键盘没有落在 Webview。
- [ ] **M02c Customizer→Text**：焦点从参数输入框切回源码，再测试；记录是否需手动点击 editor。
- [ ] **M02d LSP**：启用既有 LSP 后单独观察格式/建议参与的 Enter；记录 LSP 版本。若未安装则 BLOCKED，不计 PASS。

## M03：真人点选 → 原约束修复 → 旧反馈 stale

目的：CAD-P4-AGENT-02，真实空间反馈；模型只辅助，手动动作由操作者完成。

1. 使用新的 project-a/model.scad，确保 hole=2，Manifest/profile Hash 等于 fixture.json；不打开 Preview。在内置 Agent 选定模型，要求 `model_listParts(uri=verification.json)` 与 `model_checkAssembly(uri,expectedManifestDigest)`。保存当前 PASS 报告和基准 digest；这不是人工写报告。
2. 要求 `model_getFeedback(reportId)`，再 `model_requestPointing(reportId,prompt="在 body 孔口表面点击并填写将孔半径从2改为3",ttl=180)`。在原生确认 UI 阅读并由真人批准。
3. 在冻结 CAD Evidence 视图点击 **body 实体孔口表面**，观察空间标记，填写文字，再亲手点“保存并发送位置”。截图同时包含目标与文本；不运行脚本坐标/浏览器自动化，不把在 Chat 说“同意”当提交。
4. 收到真实 ACCEPTED 后，若模型提出原生编辑，真人检查完整 patch 并仅允许临时 model.scad 的 `hole=2;`→`hole=3;`，可保存。Manifest/profile/parts/transform/其他源码不改。此编辑不在自动 allowlist 中。
5. 要求同 manifestDigest 复验全部约束；新报告 PASS、新 snapshot。比较 baselineReportId+targetReportId 且 expectUnchangedPartIds=["shell"]，验证 shell 整体 unchanged。读取旧 feedback 应 stale；不声称 body 内部局部未变或打印成功。

- [ ] M03a 原生确认实际批准（记录工具ID／确认截图）。
- [ ] M03b 真人表面点击＋文字＋显式发送产生反馈（记录 anchor/triangle/sourceHash/camera）。
- [ ] M03c 正确受限编辑＋固定基准完整复验（Manifest/profile Hash不变）。
- [ ] M03d shell 保护＋旧反馈 stale＋报告终态（记录每次工具是模型还是人工要求补调）。

模型未继续时保留准确停点和耗时；可另进行 assisted 手动验证，但不签模型闭环 PASS。180 秒过期标 EXPIRED，由真人明确开启新请求，并保留旧记录。

## M04：拒绝、取消、关闭和过期（互相独立的新请求）

目的：无批准不得产生日志中伪造的空间反馈，不等待隐藏在模型超时里。

- [ ] **M04a 拒绝**：原生 Chat 拒绝 pointing 工具。预期未进入表面请求／无新已提交反馈；记录工具结果及业务 handler 是否执行。
- [ ] **M04b 取消**：批准后在视图取消，预期明确取消且反馈数量不增加。
- [ ] **M04c 关闭视图**：批准后关闭该证据视图，预期请求结束／拒绝提交，不影响另一个有效报告。只关闭临时视图，不自动关闭所有用户窗口。
- [ ] **M04d TTL**：按产品允许的 TTL 发起请求，不提交直至过期；预期 EXPIRED/明确取消，不写反馈；过期视图不能补交成功。记录实际起止时间。

## M05：stale、刚体重映射与原锚点历史

前提：M03 已有真实提交。先保留其反馈 JSON 和 recordRevision。

- [ ] **M05a 几何变更**：hole 2→3 后旧批注 stale；仅改回源码也不能自动把旧记录变 current。
- [ ] **M05b 刚体候选**：在独立复制的临时项目，记录新基准后仅改 Manifest 的刚体 pose，再检查。此项是专门测试变换，**不算 M03 固定基准修复**。原始 local mesh Hash不变时可以提出候选；界面先标未接受，不自动转移旧批注。
- [ ] **M05c 人工确认**：真人阅读候选/新位置并接受；记录期望revision和实际新revision；保存原anchor、priorAnchors、local/world坐标和camera origin，原证据历史没有被覆盖。
- [ ] **M05d 不能映射**：改变 mesh 或删除 partId；预期不给刚体映射成功，不用近似几何猜测。

每个项目 Manifest 的授权边界分别记录。修改 M05 fixture 不得替代 M03 的“不改 Manifest”证明。

## M06：真实多 root 增删与诊断归属

目的：CAD-P4-HOST-02；当前API自动变更被拒绝／事件未完成，需要 UI 操作。

- [ ] **M06a 添加**：在临时 dev workspace 用 File→Add Folder to Workspace 加入输出中的 project-b（不加真实用户目录）；独立 STL 验证并 retainBaseline，记录其报告URI。
- [ ] **M06b 移除**：从 Explorer 真实移除 project-b。预期它的 retained store、反馈/报告及 Problems 不再通过当前工具访问；project-a 的有效owner仍在。
- [ ] **M06c 再加入**：再加同目录，预期持久证据只在允许范围内重新可见，历史/stale判断正确，没有悄悄重编译。
- [ ] **M06d 切换失效**：Runtime、Library、Customizer override 和 constraints 分四个观察；每次先取得有效报告，再只改一个输入，核对旧current=false、旧任务不发布、读取/导航复核。每个输入变化附初始与最终Hash；未覆盖的输入明确 NOT_RUN。

关闭第二项目时不删除其磁盘证据；删除/释放必须由用户显式操作。

## M07：真实未信任窗口

目的：S-01。此配置不含 `--disable-workspace-trust`。不要在真实工程降信任。

- [ ] **M07a Trust**：打开新临时目录并在 VS Code 真正选择 Restricted Mode；截图状态，确认 Workspace Trust=false。
- [ ] **M07b 调用**：经命令/原生Tool请求诊断、verify、assembly、render和pointing。预期要求Trust的入口被拒绝，不启动CLI/Worker、不改文件；仅允许明确可控的静态降级。
- [ ] **M07c 恢复**：真人信任临时目录后，同输入可执行；没有把此前拒绝缓存成PASS，也没有遗留旧Problems。

若开发宿主策略强制 trusted 而不能切换，记 BLOCKED，改用正常 installed 窗口，不能给VSCode API注入假Trust。

## M08：图片原生 DataPart 与 Provider 差异

- [ ] **M08a metadata**：对冻结报告 renderViews(cameras=["iso"],delivery="metadata")；只返回artifact元数据，相机/尺寸/meshHash一致，不执行源码第二遍。
- [ ] **M08b inline**：明确请求inline；核对原生Tool结果是 `LanguageModelDataPart.image` 或有原因的metadata回退，不把base64塞JSON。能看到图像≠模型支持视觉推理。
- [ ] **M08c 限制/不可用**：无PNG渲染环境／API不支持／超过载荷预算时，明确回退原因；已有几何事实仍有效，图片不替代验证。无法构造该环境时记 NOT_RUN。

若所选模型不支持图像，按Provider/模型能力边界记录：原生工具图像交付与模型理解分开，不将模型不能看图报告为网格失败。

## M09：Windows 原生 Unicode（发布阻断）

此项必须在Windows原生官方Runtime上做；当前状态 **KNOWN_PLATFORM_GAP**，不能通过macOS parser测试代签。

- [ ] **M09a** 在含中文、空格的项目/依赖/输出路径运行诊断、Full Render、selector装配及PNG，记录命令参数数组、Runtime版本、退出码和源Hash。
- [ ] **M09b** 原始失败修复后用完全相同Unicode输入复验；不搬到ASCII目录，不替换用户字符，不skip。

通过前跨平台发布Gate保持开放。没有Windows环境则填NOT_RUN并保留原缺口，不需在当前macOS上强行模拟。

## M10：其他平台、远程与耐久（每环境独立）

- [ ] M10a Linux原生：同VSIX，官方CLI、纯网格无Runtime、Host/installed、图像或明确不可用。
- [ ] M10b Windows原生：除Unicode专项，再验最小/Stable及installed。
- [ ] M10c Remote SSH：记录扩展/CLI/worker实际运行侧，路径、依赖与Trust边界。
- [ ] M10d WSL：同上，核对Windows/WSL路径不混用。
- [ ] M10e Dev Container：同上，重连后历史证据及stale正确。
- [ ] M10f 受控崩溃/耐久：仅在隔离测试环境、无用户数据时做跨进程崩溃；验证Hash/锁恢复/CAS/活动租约。真实断电不在当前机器自动实施。
- [ ] M10g 最大容量/几何预算：独立测试机做全规模压力；记录资源、耗时、完成度和恢复，超限/未完成不PASS。

没有目标环境时保持NOT_RUN，不计作本地模型失败或插件功能缺失。完成一个平台不自动勾选其他平台。

## M11：Codex Agent Host 的模型与工具可见性

- [ ] M11a 按 SPEC 在临时窗口选择 **Codex**，记录会话类型、实际模型 ID 和推理等级，并执行只读工具探测。环境不可用时记录 BLOCKED 及具体停点。
- [ ] M11b 若可用，在无Preview下请求网格验证→测量→问题→单图，保存实际工具Schema/结果、报告和snapshot。人工补调必须标assisted；未完成就原样记停点。
- [ ] M11c 临时SCAD中按既有允许范围做固定基准装配修复；原生编辑确认由真人审阅，不扩大Manifest权限。

不通过打开外部MCP/HTTP CAD接口绕过Provider/Host兼容性。如果该组合环境当前不可用，保持NOT_RUN/BLOCKED并记录原因，交由后续原生集成修复。
