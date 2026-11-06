> 2026-11-10 最终交接：目标已暂停，模型测试已停止；产品基线为 64a64f3，完整 SPEC 未通过。以[最终报告](customizer/final-delivery.md)及其 PASS / FAIL / SKIP / NOT RUN 清单为准。以下保留阶段历史，不代表当前正在运行。

# Customizer 架构交付检查（实施中）

2026-11-10当前状态：可审阅的实现与候选包已交付到任务分支，main未合并。Phase4尚未满足全部验收，不能作为全目标完成声明。当前权威产物为[artifact](customizer/artifact.json)，历史包与失败记录保留。


基准 main/HEAD 为 `4463d61046d962a3f5afa5ace49b21f37e6cc4a6`，与SPEC示例一致；上游 `bcf45a22caa954ca56ca287994cb6dbc368c67b2`。工作分支 `codex/customizer-architecture-v2`，没有合并 main。Phase0的Before事实保留在[完整审计](customizer-audit.md)，方案比较/逐模块决定/用户批准修订见[ADR](customizer-architecture-adr.md)。本页是当前交付审查，尚不能据此标全目标完成。

## 架构和变更

采用方案B职责重组。扫描器保持唯一声明发现源，literal与hint lexer分离；语义快照保留declared/effective，Constraints被Host和两个GUI共同消费。Rule Catalog和Fix Planner产生有证据的局部修复；独立Contract Validator报告目标结果。Editor/Agent共享buffer事务，但前者支持实际可写工作区外/untitled/untrusted静态修复，后者仍要求trust和canonical workspace。

Preset codec/只读诊断与Host事务分离。侧栏、Agent和Preview的选择/写入统一到领域服务；未绑定sidecar只读发现。删除ScadSession独立writer/replay，以及已无生产调用的ScadParameters.updateParameterSets/setActiveSet/getActiveValues/calculateActiveSetPartial。旧单测改为验证当前metadata镜像不改值的契约；实际选择/非法值/保存由领域服务浏览器与核心codec测试验收，不把死路径单测当功能证据。

不完整源码不剪裁已存Overrides；两个GUI明确提示并暂停值修改。文本使用textarea保留换行；UTF-8上限拒绝有损输入；数字手动输入不夹断，指针交互按minimum起算的步长，外部off-grid值不舍入。修复Preview group名称直接拼接RegExp的异常。

## Before → After

“本机已验证”仅指所列范围；没有将其写成跨平台/原生Desktop/模型全完成。

| Audit ID | Before | After 与依据 |
|---|---|---|
| DISC | Partial | 本机CLI/静态已验证：按行brace截止、有效赋值、同一行多声明、NFC；41例差分 |
| TYPE | Partial | 本机已验证支持子集：literal/hint独立词法、有限标量/1–4向量，不求值 |
| NUM | Broken | 有效范围/step/交互本机CLI与浏览器通过；官方Desktop12项交互已验证；完整pinned GUI仍Unverified |
| ENUM | Partial | 默认补项、混合类型/顺序、native preset首次匹配通过 |
| TEXT | Partial | UTF-8导入差分及两个GUI换行/无损拒绝通过；与native有损截断的差异明确保留 |
| GROUP | Partial | pinned组语义和GUI投影已验证；Desktop具体布局不宣称一致 |
| DESC | Broken | 上一行列首//描述规则已验证 |
| DIAG | Partial | 8规则、evidence、fix safety、稳定legacy code、反例与Host Problems通过 |
| FIX | Partial | 4类保守safe fix、诊断关联和执行时CAS通过；最低Host原生Undo/Redo实际通过 |
| VALID | Partial | source/contract/quality独立状态、details和完整性失败传播通过 |
| TOOLS | Unverified | 已安装Production LM invoke通过；native Chat实际Analyze已证明；指定模型完整任务未通过，不能由注册代替 |
| OVERRIDE | Partial | GUI/Preview/Agent共同domain；强类型batch/revision/busy和CLI参数通过 |
| TX | Partial | CAS/信任/工作区/文档类型/TTL/一次性/实际50edits测试通过；最低Host原生Undo已通过；Remote未验 |
| GUIVAL | Partial | 删除主DOM重复校验，Preview消费共享约束；浏览器有效/非法值通过 |
| GUIUX | Partial | 键盘/组/窄窗口/tooltip/焦点/incomplete/inert真实Chromium通过；最低Host原生Enter已通过 |
| PREVIEW | Unverified | Preset→真实session→renderer、值隔离/continuous/fallback/incomplete保留通过；Desktop未验 |
| PSCHEMA | Partial | 官方字符串编码、未知版本只读、绑定JSON Problems真实Host通过 |
| PIO | Partial | shared controller、stage/复核/rename、故障/并发/清理通过；跨进程最后read/rename仍有竞态，Remote provider未验 |
| PARTIAL | Partial | 按批准defaults+当前集；A→B→Default两个入口和Preview通过 |
| RES | Partial | catalog生成校验及7个packaged相对链接通过；原生Skill入口与Analyze调用已实测；完整模型编辑/验证任务未通过 |
| LSP | Unverified | 与Customizer独立集合、配置/关闭生命周期Host通过；native键盘缩进已在最低Host通过 |
| RELEASE | Unverified | 本机构建/VSIX安装已执行；候选VSIX重建及安装通过；三平台contracts通过，Windows真实Library仍失败；Remote未执行 |

## 验证与限制

命令、精确数量、失败历史见[进度](customizer-progress.md)与[验收编号台账](customizer-acceptance.md)。最新全量 `npm test` 为core215 PASS、Preview99 PASS、Library26 PASS/3 SKIP；随后提供真实CLI/Exporter并启用online补跑Library29 PASS/0SKIP。Host1.140.0最新33 PASS/0FAIL；首次新增32项运行31 PASS/1 FAIL（原生输入多fu），定向与整套重跑通过，未证明偶发根因，原失败日志保留（更早3项焦点问题已用限定测试PID的激活helper解决）；浏览器完整40 PASS（37侧栏+3 Preview），没有把跳过或编译计作通过。

普通无Hint、表达式、Hidden、有效重复赋值、off-step、缺省下拉默认值、闭括号尾随prose的固定反例均保持默认Problems静默。CLI/静态fixture和实际Host/浏览器是不同证据，不能相互替代。

存储事务保持未保存源码、Preset其他sets/未知成员/版本，Agent编辑沿用确认与单次计划；Editor不被Agent工作区边界回退。扩展内文件写入串行并复核原bytes，但provider rename不构成跨进程CAS。未知版本不应用/覆写。不可信源注释/JSON不被视为授权。

架构检查：core7→14文件、非空行812→1164；增加规则/词法/独立事务的职责边界，无core runtime循环或host依赖。该检查不证明全项目无循环，也不替代维护性审查。100KiB本机p95约1.22ms，1MiB单样本5.22ms；非跨平台指标。

指定 qwen3.5:2b-mlx 的原生工作流已进入实际工具执行，但完整模型验收尚未通过；最终VSIX、证据归档、清理后35项浏览器和32项最低Host验收已执行。三平台CI和指定服务的真实Host heap已补证据；Windows Unicode include失败，Remote、完整pinned Qt及更广GUI/GPU内存仍缺证据；本地可执行范围继续推进，不能先标完成。


当前产物：[artifact](customizer/artifact.json)，[持久证据索引](customizer/evidence/manifest.json)，[模型验收事实](customizer/evidence/native-agent-summary.json)。当前目标保持active；没有将缺失的模型/平台证据判作完成。

指定模型的逐项结果、真实调用、失败回答与观察脚本限制见 [qwen3.5:2b-mlx 验收](customizer/model-acceptance.md)。没有把模型的“任务完成”声明当作后置验证。

真实最低Host Source/Editor内存验证已有三快照的1→2→1实例对照；范围与整体heap背景增长见 [生命周期验证](customizer/lifecycle-validation.md)。官方Desktop CLI另有41例匹配，官方Desktop12项Qt+echo已通过，完整pinned Qt未验，不能由CLI替代。


当前分支提交a874f3f的真实CI：Agent三平台contracts及panel全部成功，native各41+6通过；Linux/macOS Library成功，Windows因Unicode路径失败。证据见customizer/evidence/ci-a874f3f-summary.json。三平台结果没有替代SSH/WSL/Container或桌面交互。

新增未通过项：超限源码默认值能写出不可重新apply的Preset，真实Host已复现；ADR10待用户决定保存策略。此为历史发现；2026-11-10用户批准ADR10方案A后已修复，并通过核心/浏览器/真实Host及安装包路径验证。最新10例本机native导入边界另存，不回写历史CI证据。

最新已结束CI对应721bbf5：三平台native各41 schema + 10 import通过；Agent四jobs成功（跳过范围同前述矩阵），Linux/macOS真实Library成功，Windows Unicode Library失败。新增边界与归档digest见customizer/evidence/ci-721bbf5/native-artifacts.json。此处为历史CI，Preset缺陷已按ADR10修复并验收，GUI已解锁并实际通过12项，整体目标仍未完成。


2026-11-10最终增量：ADR10当前快照拒绝有损保存、强类型baseline、现有集导出/删除不被当前无效值阻塞；官方Desktop12项真实GUI+echo通过，用户偏好SHA不变。当前核心215/Preview99/浏览器38通过，最低Host最终33通过；中间32+1输入多p失败保留且根因未明。此前的包并行输出竞争已发现，交付包须以串行重建并重新安装后的artifact.json为准。精确pinned Linux CLI已在42742920562完整构建并通过41+10探针；该轮产物上传缺失，修复归档的后续run42748900128进行中，完整pinned Qt不在此通过范围。


生命周期增量：销毁后的Preset/Domain不再能改共享值，真实Host33与浏览器40通过；真实Host五类服务V8快照0→1→0、6轮缓存/watcher/订阅释放已验。最近单独的加载边界复测为侧栏37与Preview3分别通过，不冒充此前同一条全量命令。qwen温度0两次controller中断独立留存；按用户追加指定标签mimo-v2.6:latest补测进行中。Windows Unicode include仍FAIL，不用skip隐藏。


当前精确pinned Linux CLI完整构建与41+10探针及下载归档hash均已验，见customizer/evidence/pinned-34c64eb；Qt全程序/全平台仍未覆盖。最终候选fac54ddf…51e1a仅增加Skill intent字段说明，已串行打包并实际最低Host安装验证。mimo四项MODEL窄断言已通过，Author真正完成三目标/未保存，但Author/Tail重试预算和错误回答仍使SPEC9.3协议Partial；逐项事实见模型台账。新增公开continuation字段的ADR11等待确认，不以模型成功为由弱化现有安全门。
