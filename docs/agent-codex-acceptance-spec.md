# Codex 原生 Agent 验收 SPEC

VS Code Codex Agent Host 优先使用 `gpt-6.2-sol`。会话模型目录缺少该模型时，使用 `gpt-6.1-sol`。两者推理等级均为 `Low`，证据按实际模型登记。本轮包含 16 个主场景。旧候选和旧模型的结果保留在各自的历史台账。本轮状态见[运行记录](#本轮运行记录)。

## 候选与宿主

1. 设置 `SCAD_OPENSCAD_EXECUTABLE` 指向官方 OpenSCAD，执行 `npm run test:cad:closeout -- baseline`。执行 `npm run test:customizer:source`、`npm run test:customizer:compatibility`、`npm run test:customizer` 和 `npm run test:agents:ui`。留存 `.build/cad-closeout/baseline.json` 与命令输出。按[开发指南](../CONTRIBUTING.md)构建生产 VSIX，并用同一包分别跑最低支持版与 Stable 的完整 Host、资源检查及隔离安装。
2. 记录源码 HEAD、baseline candidate ID、构建与 VSIX SHA256。用 `npm run prepare:cad:manual` 生成合成夹具，记录输出的 `workspace`、`fixture.json` 和各文件 Hash。每个会改写文件的场景使用新生成的夹具。使用临时工作区和隔离配置，保持 Save Before Send 与 Auto Save 关闭。
3. 先准备 Codex 扩展，再将生成命令输出的工作区路径传给现有启动脚本。默认 F5 **Run Extension + Codex** 仍打开开发仓库。

   ```sh
   node scripts/prepare-codex-dev.mjs
   npm run prepare:cad:manual
   node scripts/run-codex-dev.mjs 9236 .build/cad-manual/current/manual.code-workspace
   ```

4. 在隔离窗口选择 **Codex** 会话，检查模型目录并按上述顺序选择。在实际会话记录模型、推理等级、宿主版本和会话 ID。使用备选时留存目录证据。先用两次只读原生调用探测：对 `project-a/inward.stl` 调用 `scad_ai_ide_model_analyze`（`mode: "verify"`），对 `project-a/customizer.scad` 调用 `scad_ai_ide_customizer_sourceAnalyze`。记录工具输入输出及完成状态。工具目录、模型自述和直接 Host 调用只提供各自层级的证据。模型、等级或工具无法确认时，将受影响的场景标为 `BLOCKED`，继续独立 Host 验收。
5. 每个正式场景使用独立会话。保持现有 Workspace Trust、原生编辑确认、路径授权及工具注册方式。编辑和写入限于本轮合成夹具或隔离的测试仓库与 profile。需真人授权、点选或提供目标环境时，记录实际决定与停点。

## 16 个主场景

| ID | 任务与通过条件 |
|---|---|
| CAD P1 diagnostics | 以 `dirty.scad` 造出磁盘和编辑器输入不同的状态。真实诊断 FAIL，只把 buffer 中 width 从 0 改为 1，复验新快照 PASS、Problems 撤销、assert/cube 保留、buffer 仍 dirty、磁盘逐字一致，并结束会话。 |
| CAD P2 mesh | 对 `inward.stl` 使用同一报告完成 verify → measure → getIssue → renderViews。核对 signedVolume=-1、physicalVolume=null、modelUnits、恰好一张 iso 冻结图及磁盘 Hash。 |
| CAD P3 assembly | 读取 `assembly/.scad/verification.json` 的部件和约束，按固定 digest 检查 FAIL 并读取 issue。获准后仅改临时源码 gap 0.18→0.30，可保存。相同 digest 的新快照全部必需约束 PASS，测量和单张 `cameras: ["iso"]` 冻结图指向新报告，Manifest 和其余源码字节不变。 |
| CAD P4 comparison | 对同一文档用显式 `units: "mm"` 建立并保留冻结基准。正式请求前由夹具准备者只改临时孔半径，形成可比较的目标。模型用当前目标报告及显式 baseline/target ID 完成比较，按 `.scad/print-profile.json` 执行筛查。核对报告、不同快照和 `printability: NOT_CHECKED`，正式请求期间源码、Manifest、profile 字节不变。 |
| Customizer MODEL00 | 对照 dirty buffer 和磁盘 Hash，实际 Analyze/Validate 使用未保存内容。 |
| Customizer MODEL01 | 用 `customizer.scad` 按原 SPEC 创建 Slider、Dropdown、Hidden 三目标，执行并审阅 Analyze → Plan → Commit → Validate。核对 3/3 matched、默认值和几何字节、dirty 与磁盘状态。 |
| Customizer MODEL02 | 尾注带说明时，遇 NEEDS_MANUAL_REVIEW 停止结构化编辑，保留全部说明并解释人工处理。 |
| Customizer MODEL03 | 保留表达式参数。如实区分 unsupported default、静态分析和语法检查，正常结束。 |
| Customizer MODEL04 | 实际触发 `semanticPass=false` 和缺失 URI 的 `ok=false`，保留文件并准确报告两个结果。 |
| Customizer MODEL05 | 真人在扩展的 VS Code 确认中选择 Skip 后，核对 Commit 返回 `CANCELLED`、未提交 WorkspaceEdit、无重计划或备用 writer，buffer/disk 字节不变。 |
| Customizer MODEL07 | 夹具准备时将 version 99 的 Preset 导入并关联到目标源码。正式请求读取该目标的原生状态，准确报告只读及操作拒绝原因，保留源与 JSON。 |
| Customizer MODEL08 | 按 ADR12 使用 dirty-buffer 位置解释合法覆盖与可见性契约，保留赋值。 |
| Runtime | 实际目录 ID、安装终态、激活选择及 GUI/状态栏/Preview 一致。验证取消或离线错误，以及非受管路径删除的拒绝。 |
| Customizer Overrides / Preset | 用实际 target/revision，对合法数字类型变更核对 GUI/Preview。无效批量请求保持原子，切换文档后拒绝旧 revision。覆盖建、存、重置、应用、导入、导出、删除与外部改动。核对 SCAD 源字节。 |
| Libraries | 在隔离项目安装明确版本，核对 manifest、lock commit 和挂载，使用实际版本键校验和恢复。清理计划需确认，取消或过期保持资源。 |
| More / Dev | 核对真实认证状态与授权 UI，按权限执行脱敏检查及受确认的隔离缓存清理。Production 对 Dev 工具的拒绝独立记录。 |

CAD 判定沿用[收尾条目](cad/acceptance-closeout.md#未闭合项目台账)与[覆盖映射](cad/closeout-coverage.md)。Customizer 指令、夹具和精确断言见 [SPEC v2 §9.3、§11.2](customizer/spec-v2.md)和[原始测试取证](customizer/evidence/closeout-20261111/native-cases.json)。MODEL06 用 Host 核验 stale/replay，MODEL09 汇总实际终态和回答准确性。管理工作流使用 [Agent 验证指南](agent-verification.md#real-model-verification)的业务断言，并记录实际触发的 Skill 与 Instruction。

## 记录与判定

- 输出到 `.build/codex-acceptance/<run-id>/`。每场记录候选/VSIX/夹具、宿主、扩展版本、实际模型/等级/会话、工具输入输出、报告和快照、确认决定、buffer/disk Hash、终态与最终答复。仅归档合成夹具及脱敏证据。
- `PASS` 要求实际场景及后置断言全部通过。`PARTIAL` 表示已有通过证据但仍缺部分断言。`FAIL` 用于实际失败，`BLOCKED` 用于缺失前提，`NOT_RUN` 用于尚未执行。修复后保留原记录并复验受影响项。程序等待授权和模型终态分别记时。
- M11a 复用宿主探测证据，M11b/c 分别关联网格和装配。空间反馈、Trust、动态工作区、绘图交付、焦点、Windows Unicode、远程宿主和耐久仍逐项填[手动清单](cad/manual-acceptance.md)。真人操作、自动回归、模型和发布分别签署。

## 本轮运行记录

2026-11-19，源码 HEAD `18aebce` 加本轮验收脚本变更。CAD baseline 与最终夹具均绑定 candidate `efeab6e8989668166a05d194ac21bffd9af681cf20c88a678b223e18aea5bace`。生产 VSIX SHA256 为 `22b3a49bdadf68234d65d58172b3f7e40be76567335ba3b6437a4e84f9351b5b`。

| 检查 | 结果 |
|---|---|
| CAD baseline | PASS。默认回归、真实 CLI、清单、冻结视图、GPU、构建和 CAD Host 专项均 exit 0。CAD Host 22 PASS、1 PENDING（动态工作区）。首次受限执行的两项 CoreGraphics 失败保留在原日志。 |
| Customizer / AI Panel / VSIX | 源码 48 PASS、兼容性 42 PASS、UI 42 PASS、AI Panel 1 PASS。生产包静态资源检查通过。 |
| 完整 Host | 1.140.0 与 1.146.0 各 60 PASS、2 PENDING、3 FAIL。三项 FAIL 均停在原生窗口焦点检查。 |
| 隔离安装 | 两版均在等待原生窗口获得焦点时超时。启用现有焦点辅助并串行重试，仍在同一断言处超时。 |
| Codex 原生场景 | 0/16 PASS，16 BLOCKED。VS Code 1.146.0 的 Codex 会话目录缺少 GPT-6.2 Sol。Agent Host 日志已显示两个探测工具进入客户端目录，实际调用尚未执行。隔离安装的 Marketplace 正式版与预发行版携带相同 Codex 二进制。临时设置新版 CLI 后，原生模型选择器仍未出现目标模型。 |

日志、模型选择器快照、工具目录投影及 VSIX 在 `.build/codex-acceptance/local/`，baseline 原始日志在 `.build/cad-closeout/`。

### 2026-11-19 授权备选复验

隔离的 VS Code 1.146.0 原生 Codex Agent Host 仍无 GPT-6.2 Sol。使用授权备选后，两个真实只读探测均通过。Codex 会话记录确认模型 `gpt-6.1-sol`、推理等级 `low`，并保存实际 SCAD 工具调用与结果。证据位于 `.build/codex-acceptance/sol61/`。上表的模型阻塞是选用备选前的历史结果。

16 个主场景均已执行。**10 PASS、4 PARTIAL、1 BLOCKED、1 FAIL**。

| 场景 | 结论 | 实测依据与仍缺的断言 |
|---|---|---|
| CAD P1 | BLOCKED | 原生工具读取 dirty buffer，但模型未找到只修改编辑器缓冲区的工具。夹具操作者辅助改为 width=1 后，新快照 PASS，目标文件的问题撤销，编辑器仍为 dirty，磁盘保留 width=2。 |
| CAD P2 | PASS | 同一报告和快照完成测量、反绕序问题详情与单张 iso 图。signedVolume=-1、physicalVolume=null、modelUnits。夹具 STL 未变。 |
| CAD P3 | PASS | 首次图像参数错误留档。新夹具复验在同一 Manifest digest 下由 FAIL 变为 PASS，磁盘只改 gap，测量和单图均绑定新快照。 |
| CAD P4 | PASS | 首次单位未声明及跨文件比较不兼容均留档。用同一文档的两个毫米快照复验，比较 COMPLETE，筛查返回 `printability: NOT_CHECKED`。 |
| Customizer MODEL00 | PASS | Analyze/Validate 读取未保存的 width=73，磁盘仍为 40，缓冲区 Hash 与实际工具结果相符。 |
| Customizer MODEL01 | PARTIAL | 原生四步完成，实际验证 3/3 匹配。由 Plan 的差异重建缓冲区并核对 Commit/Validate Hash，磁盘原样。缺少人工原生确认记录。 |
| Customizer MODEL02 | PASS | Plan 返回 `NEEDS_MANUAL_REVIEW`，尾注保留，无替代 writer，模型准确报告目标未达成。 |
| Customizer MODEL03 | PASS | 表达式原样保留，目标验证未通过。模型区分了语义契约失败和语法错误。 |
| Customizer MODEL04 | PASS | 实测不可满足要求的 `semanticPass=false` 与缺失 URI 的 `ok=false`，答复与两个返回一致。 |
| Customizer MODEL05 | FAIL | 请求 Commit 后直接收到 `applied:true`。未观察到可点击 Skip 的原生确认，也无人工批准动作。变更留在合成源码缓冲区，磁盘未变。 |
| Customizer MODEL07 | PASS | 在独立夹具准备中导入关联 JSON 后，新的只读会话确认版本 99、`readOnly=true`、`VERSION_COMPAT` 和默认文本的字节限制。源码及 JSON 原样。 |
| Customizer MODEL08 | PASS | 同一 dirty-buffer Hash，实际位置为第 2、4 行。模型准确解释了合法覆盖和可见性验证失败。 |
| Runtime | PARTIAL | 隔离安装并激活 OpenSCAD 2021.01，原生状态与实际状态栏一致，随后恢复原 Runtime。未验证 Preview 刷新及取消、离线、非受管移除负例。 |
| Customizer Overrides / Preset | PARTIAL | 实测强类型、无效批量原子性、`STALE_STATE` 和 Preset 建、存、重置、应用、导入、导出、删除。仍缺实际 GUI/Preview 及外部改动失效证据。 |
| Libraries | PASS | 精确安装和恢复 BOSL2 v2.0.781，核对锁定 commit、挂载和实际版本键。过期清理计划返回 `STALE_STATE`，依赖仍为 Ready。 |
| More / Dev | PARTIAL | 真实 GitHub 状态为匿名。Development 状态、列表和有界脱敏检查已执行，授权 UI、清理确认与 Production 拒绝仍待原生验证。 |

结构化取证见 `.build/codex-acceptance/sol61/observed-results.json`，每场 JSON 保留会话 ID、实际模型、推理等级、工具输入输出和终态。本次复用原候选的确定性基线及 VSIX 证据。两版完整 Host 的焦点失败与隔离安装超时仍开放。

### 修复候选复验

候选 `82519fddd2cddafa9476a770cb2ce92eefc8bc189fc3a9384cb7bc0bb0c9c890`，VSIX SHA256 `81a43c56524c788d66a10acc859823e9c7d8157482c755b74d4e93a74298296e`。上节保留原始结果。自动化报告在 `.build/native-acceptance-fix/candidate/`。本次会话模型列表缺少 GPT-6.2 Sol，按约定使用 GPT-6.1 Sol（Low），原生记录在 `.build/native-acceptance-fix/native/`。

按 16 个主场景计，保留已有的 10 项通过记录，本轮闭合 Runtime、Overrides / Preset 和 More / Dev。剩余 3 项待真人签署，分别是 Customizer MODEL01、MODEL05 和 CAD P1。

| 范围 | 新证据 |
|---|---|
| Customizer MODEL01 | `FIX-M01.json` 和 `m01-dialog.txt` 记录原生 Analyze、三项修改的 Plan 和真实确认框。计划到期时未观察到真人 Apply，脚本退出该确认，磁盘 Hash 保持原样。自动回归覆盖直接调用、重放、过期、信任状态及确认期间的源文件变化。真人 Apply 和三项目标核对待签署。 |
| Customizer MODEL05 | 操作者确认在 `customizer-skip.scad` 的原生系统弹窗点击了 Apply，对应 `FIX-M05R.json` 的 `applied:true`。`customizer-skip-2.scad` 的 `FIX-M05RR.json` 同样返回 `applied:true`，操作者选择未取证。第三个夹具的 `FIX-M05SCRIPT.json`、`m05-script-dialog.txt` 和 `m05-script-buffer.json` 记录脚本在真实弹窗点击 Skip 后返回 `CANCELLED`，缓冲区未变脏，内容与原磁盘一致。自动回归核对取消时没有提交 WorkspaceEdit。真人 Skip 待签署。 |
| CAD P1 | CAD Host 用测试授权完成 dirty 断言失败、工具修复和新快照 PASS，并核对磁盘。真实 Codex 在 `FIX-P1R.json` 再现 dirty 断言错误并提议修改，`p1-dialog.txt` 记录相同差异。等待真人操作超时，随后脚本选择 Skip，实际返回 `CANCELLED`，磁盘字节不变。真人 Apply 和原生新快照 PASS 待签署。 |
| Runtime | 复现重装在下载前删除已有版本。现先验证并公布替换版本，再清理旧安装。隔离传输测试通过取消、离线和非受管删除拒绝，核对原安装与激活状态。候选宿主从 2026.11-RC0 切到 2026.10.27，实际状态栏更新，同一已打开 Preview 重新导出网格并成功出帧。记录见 `runtime-preview-selected.txt` 与 `runtime-preview-cli.txt`。本项通过。 |
| Overrides / Preset | 原生工具将 `width` 从 2 改为 7 并保存到关联 Preset，Customizer 控制项显示 7，Preview 的真实 CLI 参数为 `-D width=7`。外部改写 JSON 后控件显示 11，增加的预设显示在列表中，Preview 使用 `-D width=11`。旧 revision 8 的原生保存返回 `STALE_STATE`，当前 revision 为 10，关联 JSON 与外部写入逐字节相同。见 `FIX-OVERRIDES.json`、`FIX-PRESET-STALE.json`、`preset-external-ui.json` 和 `overrides-preview-args.txt`。本项通过。 |
| More / Dev | 两版 Production VSIX 均拒绝 Development 能力。隔离宿主打开真实 GitHub 授权弹窗，点击 Cancel 后 VS Code 返回 `User did not consent to login`，未进入登录。More 的 Development 面板对合成缓存执行 Cancel / Confirm，前者保留两个文件的 Hash，后者只删除指定文件并刷新列表。记录见 `github-authorization-after-cancel.txt`、`dev-cache-result.txt` 和对应弹窗记录。本项通过。 |
| 自动与安装 | CAD baseline、Customizer 源码、兼容性、界面、AI Panel 及 55 项能力和安装回归通过。VSIX 静态检查通过，含 52 个原生工具。1.140.0 和 1.146.0 的完整 Host 各 63 通过、2 pending，原生 Undo/Redo 与 Enter 均通过。同一 Production VSIX 的两版隔离运行均通过。Stable 首次原生输入失败和首次重跑误用 Preview Exporter 路径的日志保留，成功复验记录见 `host-stable-desktop-final.log` 和 `installed-stable-desktop-retry.log`。 |
