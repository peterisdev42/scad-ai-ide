# Customizer SPEC 验收台账

当前状态（2026-11-10）：Phase0/0.5审计与批准已完成，Phase1–3主要实现完成，Phase4继续验收，整个SPEC未完成。ADR10方案A已实施。当前core215、Preview99、最低Host33通过；浏览器完整40通过，最新加载诊断复测侧栏37/Preview3分别通过。实际官方Desktop Qt12项通过；精确pinned Linux HEADLESS CLI完整构建及41 schema+10 import通过，首次产物归档缺失正在另轮修复。新GUI Domain/Preset真实Host堆回收五类额外实例均0→1→0。mimo四个MODEL窄断言已通过，但MODEL-01/02存在SPEC9.3重试/回答协议缺陷，qwen完整任务未达标；Windows真实Unicode include失败，Remote及完整pinned Qt/全平台GUI未执行。不以API、编译、工具注册或模型自述代替验收。

下方早期快照按原执行时点保留；当前状态以本段及末尾日期更新为准，旧锁屏/ADR待确认/未构建描述不代表当前阻断。


2026-11-09；当前为阶段性台账，目标尚未完成。`PASS` 只覆盖已执行断言，`Partial` 仍有未满足项，`FAIL` 保留真实失败，`NOT RUN` 不计通过。基准见 [audit](customizer-audit.md)，运行记录见 [progress](customizer-progress.md)。

## 上游与已批准语义

独立门 `npm run test:customizer:compatibility` 当前 41 PASS；真实 CLI runner 41 MATCH，证据 [native-phase1.json](customizer/native-phase1.json)。初始30例的10项差分已修复，不再把旧 IDE 输出当目标。补充6项导入探针见 [native-import-phase3.json](customizer/native-import-phase3.json)。执行二进制不是 pinned 全程序；相关 Customizer 源码与 pinned SHA 无差异，不据此声称桌面 GUI 或全程序兼容。

StringParameter maximumSize 参数遮蔽成员；长度保留声明值。native import 按UTF-8字节截断并可能损坏字符。IDE 明确区分 declared/effective constraints、输入转换、校验、交互增量和存储，拒绝有损文本输入，不自动扩容或截断。部分集选择采用 defaults + 当前集。未知版本保留数据且只读，未经兼容验证不得应用/覆写。

## SPEC §11 编号验收

| ID | 当前状态 | 实测依据及限制 |
|---|---|---|
| UT-01 | PASS 静态 | 普通变量/可选 Customizer 用法默认静默 |
| UT-02 | PASS 静态 | 表达式/Hidden/数组/重复赋值负例 |
| UT-03 | PASS 静态/Host | superseded hints 与最终有效赋值 |
| UT-04 | PASS 静态 | ruleId/evidence/fix 元数据、缺括号确定性修复 |
| UT-05 | PASS 静态/Host | 闭括号后 prose 不误报、不吞并 |
| UT-06 | PASS 静态/CLI | quoted delimiters、多类型/有序枚举 |
| UT-07 | PASS 核心/Host API；原生Undo已验 | 关联context diagnostics，opaque command，执行时CAS；最低Host31 PASS |
| UT-08 | PASS 静态/CLI/浏览器 | 默认值扩展有效边界，声明范围独立用于诊断 |
| UT-09 | PASS 静态/CLI/浏览器 | dropdown default 自动补项、混合类型不丢值 |
| UT-10 | PASS 静态/CLI/浏览器 | off-grid合法，step仅交互增量 |
| UT-11 | PASS 已测字符范围 | BOM/CRLF/emoji/UTF-16 span/NFC、多行hint最小编辑；未宣称任意Unicode全覆盖 |
| UT-12 | PASS 静态/CLI | 首brace整行、include文件名brace、字符串/注释/多声明 |
| UT-13 | PASS 静态/Host API | expectationResults.details、独立contract/source/quality状态；不冒充Problems |
| UT-14 | PASS 静态 | 未请求目标=notRequested；过滤警告不能隐藏验证失败 |
| UT-15 | PASS 核心 | 4类确定性Hint fix、幂等、无目标外变化；歧义转人工审查 |
| UT-16 | Partial | Agent/Editor分别校验、CAS/hash/关闭/expiry/一次性/只读；最低Host原生Undo/Redo通过；已测50edits/32plans/16cache/32KiB/1MiB/501项边界，未宣称所有provider/heap可验证 |
| UT-17 | PASS 核心/浏览器 已测范围 | 官方字符串编码、额外成员、A→B→Default、未知版本只读；跨平台provider未验 |
| UT-18 | Partial | 损坏JSON/非法值保持原数据、原子stage/rename与并发单测；绑定Problems真实Host通过，跨进程最终read/rename竞态仍存在 |
| UT-19 | Partial | 1MiB/incomplete/global64KiB metadata已测；501项、16cache、50edits、32plans、32KiB正反边界已测；100/200 diagnostics与global64KiB共同预算先到者截断；Source/Editor及GUI Domain/Preset指定服务真实Host heap已测，renderer/GPU未测 |
| UT-20 | PASS 固定语料范围 | 1,200例固定种子普通长尾注，含引号/括号/反斜线/Unicode/超长说明，均无默认警告；不宣称覆盖所有任意输入 |
| HOST-01 | PASS 已执行生命周期 | source diagnostics配置/保存/关闭，绑定Preset Problems和未保存JSON实际Host通过 |
| HOST-02 | PASS 最低Host | context→safe fix→command及stale拒绝通过；最低Host原生键盘/Undo已通过 |
| HOST-03 | PASS 最低Host | Analyze→Plan→Commit→Validate、未保存/disk不变API通过；最新最低Host native Undo/Redo均通过（早期窗口焦点失败保留） |
| HOST-04 | PASS | 并发编辑→STALE_SOURCE，不覆盖新文本 |
| HOST-05 | PASS 已测范围 | GUI domain/schema与source一致；官方Desktop实际Qt12项通过，完整pinned/全平台GUI未验 |
| HOST-06 | Partial | 强类型batch/revision、浏览器Preset/Preview通过；统一路径浏览器/Host API通过；远程provider验收未执行 |
| MODEL-01 | 未通过：原生请求错误 | 最终三目标复测Analyze成功后native no response；0次Plan/Commit/Validate，buffer/disk原样。本轮0次确认拒绝，无观察超时。旧Plan错误/确认预算中断保留，详见模型单独台账 |
| MODEL-02 | FAIL | qwen3.5:2b-mlx 3次Analyze，0次Apply/Validate；buffer/disk及prose未变，schema仍spinbox；模型却声称编辑并保存，且未解释人工处理。观察脚本旧超时另记，不作为模型失败原因 |
| MODEL-03 | Partial | qwen3.5:2b-mlx 原生 Analyze；未改源码、未称语法错误；最终说明错误地声称 width 有 spinbox 并给出无效 slider() 用法，不能整体通过 |
| MODEL-04 | 未通过：目标检查未执行 | qwen3.5:2b-mlx 反复调用内置 read_file 后 native no response；目标 Validate/缺失文件 Analyze 均未调用，没有实际 semanticPass=false 报告证据 |

## 当前执行快照

- Phase1独立兼容门41 PASS，native差分41 MATCH；Phase2 source36 / capabilities27 PASS。
- `/tmp/customizer-phase3-unified-all2.log`：core204 PASS，library26 PASS / 3 SKIP，preview98 PASS。
- `/tmp/customizer-phase3-fields-ui.log`：真实Chromium31 PASS，含Preview数字键盘、拒绝手动越界/允许off-grid、group标点、多行文本，以及侧栏完整回归。更晚的domain统一用例另在progress更新。
- `/tmp/customizer-phase2-host-minimum.log`：真实VS Code1.140.0，27 PASS / 3 FAIL；失败是2项native Undo/Redo及1项native Enter不能取得窗口焦点。API通过不替代原生交互。
- 初始VSIX/installed smoke是历史证据，未包含本次全部改动，不能作为最终发布物通过。

## Definition of Done

权威语义、规则、安全事务、状态分离与主要GUI/Preset路径已实现；生命周期/配额/性能验收继续。当前候选VSIX重新构建安装已通过；真实模型未全通过，pinned全程序、native Desktop控件及Remote仍缺证据；三平台CI与指定服务的真实Host heap已有下述限定范围证据。缓存销毁已有边界测试，不等于heap profile。跨平台CI已远程执行：三平台Agent contracts及native差分通过，Linux/macOS真实Libraries通过，Windows Unicode include失败；Remote未执行。Before/After与风险清单已在交付检查中记录；全目标验收未完成。


## Phase 4 当前验收更新

最新最低Host1.140.0 **32 PASS / 0FAIL**：`customizer/evidence/host32-repeat.txt`。新32项首次31 PASS/1 FAIL（native输入多fu）；定向1 PASS，原断言整套重跑32 PASS，根因未证实；失败日志保留。早期31项见 `customizer/evidence/host-native-focus.txt`。早期3项native焦点失败保留；使用严格限定测试PID/app/testflags的macOS激活helper后，实际Undo/Redo/Enter通过。GUI最终 **35 PASS**：`evidence/browser-latest.txt`；Preview会话清理后99 PASS。提供真实CLI/Exporter/online后Library29 PASS/0SKIP。最终VSIX及隔离Production安装通过，见 `customizer/artifact.json` / `customizer/evidence/installed-explicit-contract.txt`。

原生 Agent 环境阻断已解除，指定模型的实际调用与失败证据见 `customizer/evidence/qwen2b-*`，当前模型状态以上方编号表为准。当前目标保持 active；工具注册、API smoke 和单次成功 Analyze 均不代表完整模型任务通过。

可重复的macOS Host焦点前提：`swiftc -module-cache-path .build/swift-modules scripts/fixtures/customizer-focus.swift -o .build/customizer-focus`；设置SCAD_TEST_FOCUS_HELPER与SCAD_TEST_FOCUS_APP（精确缓存.app路径），并传SCAD_TEST_WORKSPACE/SCAD_PREVIEW_EXPORTER后运行test:integration。helper拒绝非测试PID/错误app，不激活用户日常窗口。


生命周期补充：`node --expose-gc scripts/customizer-memory.mjs` 对实际SourceDomain/EditorActions类和真实临时文件执行1轮预热+6轮测量，每轮32文档/32 source plans/32 editor plans，cache上限16，销毁后maps与3个订阅均归零。每轮GC释放约3.86MB，销毁后heap区间79,960 bytes。该证据使用注入document/event端口，不能替代整个VS Code的heap profile。数据见 `customizer/evidence/lifecycle-memory.json`。

原生模型单独台账见 [qwen3.5:2b-mlx 验收](customizer/model-acceptance.md)，其中明确区分已执行断言、未执行目标、错误说明和观察脚本中断。

## 真实 Host heap 补充（覆盖早期“仅注入端口”的范围）

最低Host1.140.0、真实TextDocument/事件/文件系统：32文档、16cache、32+32plans，预热+6轮dispose；三份V8完整Host snapshot证实两类实例各1→2→1，新增实例无保留，每轮释放3.60–3.80MB。宿主总heap区间仍8,028,740 bytes，不据此宣称全扩展无泄漏。首次socket路径过长启动失败保留。数据与范围见 [生命周期验证](customizer/lifecycle-validation.md)。原先的注入端口数据保留为不同证据，不冒充本项。

另以官方2026.11.06 Desktop二进制执行41例.param差分全部匹配，见 `customizer/native-desktop-cli.json`；GUI控件还未通过动态验收。当前Accessibility/CGPostEvent权限已生效，但WindowServer锁屏（CGSSessionScreenIsLocked=1）阻止激活/截图，正在等待解锁。原生用户偏好写入由OS沙箱拒绝；初次环境隔离失效所改recentFileList已按原备份恢复并验证语义相同。


## 最新跨平台与新增失败门

当前提交a874f3f：Agent run42631083903四jobs全部成功，Library run42631083471的Linux/macOS成功、Windows失败。三平台各41 native schema + 6 import通过并核对归档digest；详见customizer/evidence/ci-a874f3f-summary.json。Windows Unicode include绝对/相对/junction均失败，未用跳过掩盖。NFC测试有明确实验feature profile，不代表默认编译选项。

新发现Preset当前值快照roundtrip失败：真实Host create成功，但同一集apply报PRESET_INVALID_VALUE；源未变。ADR10待确认，新保存门禁及对应GUI/Host验收尚未执行。native文本显式默认值截断/省略保留、numeric max-only导入边界已补入10例本机探针；不能拿它替代跨平台6例之外的验收。

最新已结束CI对应721bbf5：三平台native各41 schema + 10 import通过；Agent四jobs成功（跳过范围同前述矩阵），Linux/macOS真实Library成功，Windows Unicode Library失败。新增边界与归档digest见customizer/evidence/ci-721bbf5/native-artifacts.json。该段为721bbf5历史状态；ADR10已于2026-11-10批准实施，GUI解锁后的最终状态见下。


## 2026-11-10 当前验收更新

ADR10方案A已批准并实现：当前值保存前共享校验及无损编码重放检查；delete/已有sets export不依赖当前快照。强类型baseline正确区分同编码的数字/字符串，也保留部分集省略的原始默认值。core215/Preview99通过、默认Library26通过/3跳过、浏览器38通过。最低Host全套最终33通过（evidence/adr10-host-final.txt）；同日上一轮32通过/1失败，native Enter多p，故障事件trace已加入仅合成文档的诊断，复测未重现，根因仍未知，失败不删除。

官方Desktop Qt矩阵12项通过且每步核对echo、buffer/disk及原偏好SHA。NATIVE-UI-01..08的精确范围见customizer/native-gui-validation.md，不代表完整pinned Qt或全平台GUI。旧锁屏和controller失败保留。原生指定模型失败、Windows Unicode真实Library失败、Remote未执行仍未改为通过。

精确pinned上游CLI已在4bff75e run42742920562实际完成Linux源码构建及41+10差分，通过范围为HEADLESS/NULLGL、CGAL+Manifold、experimental；该轮隐藏目录产物未上传，另轮修复归档正在运行。完整pinned Qt及全平台GUI仍未验证。


## 当前模型收齐与协议缺口

mimo指定本地标签四场景正常结束；MODEL-01实际3/3目标matched、commit成功/未保存/几何默认值不变，MODEL-02保留尾注并解释人工处理，MODEL-03不报表达式语法错或自动折叠，MODEL-04如实报告实际失败，四项窄断言通过。SPEC9.3并未整体通过：Author在成功前多次非法commit且最终解释错误；Tail四次重复plan并尝试被禁止的普通writer，被controller拒绝后仍错误声称未用其他writer。整体模型协议维持Partial，详见customizer/model-acceptance.md及逐项review.json。原生模型真正成功的业务结果与其错误总结分开记录。ADR11新增结构化continuation待确认，不先实施。
