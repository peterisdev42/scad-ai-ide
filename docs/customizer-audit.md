# Customizer Phase 0 审计（2026-11-09）

SPEC: [本次输入副本](customizer/spec-v2.md)。本报告基于源码阅读及本次执行，历史 .build 日志不算证据。

## 基准与范围

- 起始 main/HEAD: `4463d61046d962a3f5afa5ace49b21f37e6cc4a6`，与 SPEC 一致，无差异分析项；初始工作区 clean。
- OpenSCAD: `bcf45a22caa954ca56ca287994cb6dbc368c67b2`；LSP `0955859bcbbbb77eca0f9f4f1e6ef09dc0e3410a`；preview `5429e7ef2e499e77a2fb8613e781e859326abf90`。
- 工作分支 `codex/customizer-architecture-v2`，不合并 main。无适用 AGENTS.md；不对 sibling registry 写入。
- Node v24.16.0 / macOS arm64。本机 PATH 未发现 openscad；cached VS Code 1.140.0 可用于后续 host 验证。后续发现 managed OpenSCAD RC0，见 native 证据。

## 本次基线

| 命令 | 结果 | 证据 |
|---|---|---|
| npm run test:customizer:source | PASS 25/25 | /tmp/customizer-baseline-source.log |
| npm run test:capabilities | PASS 24/24 | /tmp/customizer-baseline-capabilities.log |
| npm run test:customizer（沙箱外重跑） | PASS 24/24 | /tmp/customizer-baseline-ui-unrestricted.log |
| npm run test:customizer（首次沙箱内） | FAIL 环境启动 | /tmp/customizer-baseline-ui.log，Chromium Mach bootstrap permission denied；沙箱外重跑单列 |

通过 mock/纯函数不等于入口和 native 全部完成，下表不会因此填写 Complete。

## Feature Audit Ledger

所有路径相对 src/（media、scripts、skills 和 .github 除外）；callsite 以函数名定位，避免重构后行号失效。

| feature ID | 能力 | expected official behavior | current behavior | source path + callsite | user reachability | test evidence | status (Before) | defect/risk | architecture decision | priority |
|---|---|---|---|---|---|---|---|---|---|---|
| DISC | 声明发现 | 主文件、最终赋值、首个有效花括号前 | 扫描器跳过字符串/注释/include；同一行截止与上游按行截止有差异 | core/customizer/CustomizerParser.ts:scanCustomizer | GUI / source tools | customizer.test.ts; sourceAnalyzer tests | Partial | 同一行多声明和 NFC 边界待校验 | REFACTOR | P0 |
| TYPE | 字面量/向量 | 有限标量与 1–4 数字向量，不求值表达式 | 支持 hex/科学计数/转义；标识符不支持组合标记 | core/customizer/CustomizerParser.ts:parseLiteral | 全部参数入口 | customizer.test.ts | Partial | Hint lexer 错用源字面量语法 | REFACTOR | P1 |
| NUM | Slider/Spinbox | 声明与有效范围分离；步长不拒绝合法默认值 | range 只有声明值；校验强制网格 | core/customizer/CustomizerService.ts:validateValue | GUI / set / Preset / Preview | 旧测试冻结 steps 拒绝 | Broken | 越界和 off-step 默认值与 host 校验冲突 | REFACTOR | P0 |
| ENUM | Dropdown | 补入默认项、混合值与标签 | 已补入；字符串单数字项语义待差分 | core/customizer/CustomizerParser.ts:annotate | GUI / tools / Preset | customizer.test.ts | Partial | 源字面量和 Hint 引号语义混用 | REFACTOR | P1 |
| TEXT | Textbox/Checkbox | bool 无 Hint；文本长度依上游版本 | 已渲染；长度未分原始/有效，UTF-16 与 native UTF-8 差异 | media/customizer/main.js:createParameter | GUI / set | customizer.test.ts; browser suite | Partial | 超长默认值校验拒绝自身；Unicode 长度待验证 | REFACTOR | P1 |
| GROUP | Groups/Hidden/Global | 大小写敏感，单行块组，多 [] 拼接 | Hidden/Global 支持；仅 standalone heading，块描述错误参与 description | core/customizer/CustomizerParser.ts:scanCustomizer | GUI 树/Agent | customizer.test.ts | Partial | 上游 collectGroups 对无标题单行块也重置分组 | REFACTOR | P1 |
| DESC | Description | 仅前一行第一列 // | 累积独立注释，跨空行、缩进、块注释 | core/customizer/CustomizerParser.ts:scanCustomizer | GUI tooltip / source contract | 旧测试明确断言累积描述 | Broken | 会误认为已达成描述契约 | REFACTOR | P0 |
| DIAG | 静态诊断 | 仅有效显式异常 Hint、精确位置、稳定规则 | 有效赋值过滤正确；只有 legacy code/suggestedFix | core/customizer/CustomizerSourceAnalyzer.ts:analyzeCustomizerSource | Problems / Analyze | baseline source 25 PASS | Partial | 缺 rule/evidence/fix 元数据、完整性原因 | REFACTOR | P1 |
| FIX | 规则修复 | 关联实际诊断、局部可证实、提交重验身份 | 未读取 context；直接 WorkspaceEdit；仅零 step 修复 | features/language/CustomizerCodeActions.ts:provideCodeActions | 编辑器灯泡 | capabilityServices mock tests | Partial | 过期 action 无二次 CAS；多条规则缺 fix | REPLACE | P0 |
| VALID | Source Validate | contract / source / completeness 独立，兼容投影 | expectationResults 已分离 Problems；semanticPass 聚合 | core/customizer/CustomizerSourceValidator.ts:validateCustomizerSource | sourceValidate / Planner | baseline source 25 PASS | Partial | issues 无稳定 code；聚合状态不易解释；重复扫描 | REFACTOR | P1 |
| TOOLS | Agent Source tools | 注册、信任、确认、CAS、真实模型任务 | catalog→registerCapabilities→LM adapter；真实模型未运行 | features/agents/registerCapabilities.ts:registerCapabilities | VS Code LM tools | capabilities 24 PASS; integration 待跑 | Unverified | 注册不证明模型自动选择 | KEEP | P1 |
| OVERRIDE | Agent runtime 值 | 强类型、revision、原子 batch、共享 GUI 状态 | 共享 service，setMany 先全量验证 | features/sidebar/CustomizerDomainService.ts:setValues | GUI / customizer.set | capabilityServices baseline PASS | Partial | GUI set 绕过 busy 领域入口；范围重复验证 | REFACTOR | P1 |
| TX | Source 编辑事务 | workspace/trust/URI/version/hash/TTL/一次性/Undo | 显式 URI，canonical path，32 plans，120 s，buffer apply | features/sidebar/CustomizerSourceDomainService.ts:apply | sourceApply plan/commit | capabilityServices CAS/path/cancel PASS | Partial | 真实 host Undo 与异步最终时序待跑 | KEEP | P0 |
| GUIVAL | GUI 校验 | 和 host 同一约束，失效状态可见 | main.js 独立重复 range/step；host 再验 | media/customizer/main.js:commit | Webview set | 浏览器沙箱启动 FAIL，重跑中 | Partial | 规则双维护与输入状态差异 | REFACTOR | P0 |
| GUIUX | GUI 结构/无障碍 | 键盘、焦点、组、空/不完整状态 | 树/aria/tooltip/presets/快捷命令已存在 | features/sidebar/CustomizerViewProvider.ts:resolveWebviewView | scad-ai Customizer view | customizer-scrollbar.test.mjs 待完成 | Partial | 不完整源码与空结果无区别；真实 Host GUI 待跑 | REFACTOR | P1 |
| PREVIEW | Preview 同步 | 覆盖值隔离、文件切换、连续输入和提交 | service listeners→preview session→CLI -D | core/customizer/CustomizerService.ts:getArguments | 预览编辑器与 Agent | src/test/preview/customizerSession.test.ts 待跑 | Unverified | 真实 native Preview 未运行 | KEEP | P1 |
| PSCHEMA | Preset Schema | parameterSets、字符串编码、部分集、元数据 | 纯解析/编码/全量预校验存在；未知版本直接拒绝 | core/customizer/CustomizerPresets.ts:parsePresetFile | Import / Apply / Export | customizer.test.ts | Partial | 缺独立结构化 Preset diagnostics；版本策略需确认 | REFACTOR | P1 |
| PIO | Preset 生命周期 | 读写/import/export/delete/watch/concurrent 无损 | 重读合并、generation、watcher；fs.writeFile 无磁盘 CAS | features/sidebar/CustomizerPresets.ts:execute/reload | GUI / preset tools | capabilityServices baseline PASS | Partial | read-write 窗口外部修改可能丢失；缺原子文件提交 | REFACTOR | P0 |
| PARTIAL | Preset 部分覆盖 | 切换部分集不能遗留上次集的覆盖 | apply 显式合并旧 getOverrides 与新 overrides | features/sidebar/CustomizerPresets.ts:apply | select / applyPreset | 待增加 A/B/default 可复现测试 | Partial | [RISK] 合并可能为历史行为，需测试与决策 | REFACTOR | P0 |
| RES | Skills/Instructions | 源码任务与值任务分离，资源真实可发现 | 2 Customizer skills 分工清楚、生成链存在 | skills/openscad-customizer-authoring/SKILL.md | contributes.chatSkills/chatInstructions | check:agents / VSIX / 模型待跑 | Partial | 缺 diagnostics/compatibility references | REFACTOR | P1 |
| LSP | LSP 交互 | 源码语法错误由 LSP；Customizer 独立低噪音 | 独立 DiagnosticCollection、200 ms debounce | features/language/CustomizerDiagnostics.ts:registerCustomizerDiagnostics | extension activation | language integration 待跑 | Unverified | LSP 开关与文档关闭需真实 Host 验证 | KEEP | P1 |
| RELEASE | 发布/性能/Remote | 资源可达、限额、跨平台、真实 host | CI 配置存在；1 MiB/16 cache/500/64 KiB 等存在 | scripts/agent-manifest.mjs; .github/workflows/agent-parity.yml | VSIX / Remote extension host | 新 VSIX / 性能 / 平台待跑 | Unverified | 本机不能证明 Linux/Windows/Remote | NEW | P1 |

## 组件设计评分

0=无证据/缺能力，1=明显缺口，2=可用但验证不完整，3=充分独立证据。C1 正确性 / C2 职责 / C3 一致性 / C4 扩展 / C5 测试 / C6 安全 / C7 维护 / C8 资源。低分依据及动作列在最后两列；分数不是 Complete 证明。

| 组件 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | 低分证据与动作 |
|---|---|---|---|---|---|---|---|---|---|
| Parser | 1 | 1 | 2 | 1 | 2 | 2 | 1 | 2 | annotate 混用 SCAD/Hint 字面量、描述累积；拆出 literal/annotation，保留 scanner 单一权威 |
| Analyzer/Types | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 临时 if 无规则元数据；建立 catalog 和 evidence/fix 类型 |
| Validator | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 再扫描、issues 自由文案；结构化状态/details，限制报告体积 |
| SourceEditor | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 多 intent 多次扫描；保留 piece 最小 diff 算法，补组合/后置/负例；先测再考虑 token rewrite |
| Diagnostics/CodeActions | 1 | 1 | 1 | 1 | 2 | 1 | 1 | 2 | action 不关联诊断且无执行时 CAS；换受控 command 提交 |
| SourceDomain | 2 | 3 | 2 | 2 | 2 | 2 | 2 | 3 | Mock 非真实 Undo 证据；重用安全边界、增加 Host CAS/Undo 验证 |
| Service | 1 | 3 | 1 | 2 | 2 | 2 | 2 | 2 | 与 DOM 重复约束；提取浏览器兼容 constraints |
| Domain/View | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | set 不走 busy 检查；统一领域入口，补生命周期 |
| Preset core/I/O | 1 | 2 | 2 | 2 | 2 | 1 | 2 | 2 | 部分集叠加风险、磁盘竞态；增加独立验证与并发保护 |
| Webview | 1 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 独立校验与不完整状态；共享约束并验证焦点/键盘 |
| Agent resources/generator | 2 | 3 | 2 | 2 | 2 | 2 | 2 | 3 | 缺规则/兼容文档、真实模型证据；资源校验、分层文档 |

## 激活、外部契约及打包链

`package.json(main=dist/extension.js,onStartupFinished,onLanguage:openscad)` → `src/extension.ts:activate` → CustomizerService + CustomizerDomainService/ViewProvider + SourceDomain + registerCustomizerDiagnostics + registerCapabilities → LM tool adapter。`catalog.json` → `scripts/agent-manifest.mjs` → package contributes / resources / GUI parity。`esbuild.js` 打包 webview 和 extension；.vscodeignore 排除 src/tests/sources/.build，不排除 instructions/skills。

必须保护：VS Code ^1.140.0；现有命令和 sourceDiagnostics 配置；工具名/schema；URI/revision 与 source identity；parameterSets 字符串编码和额外字段；sourceApply 只改未保存 buffer、120 s 单次计划、标准确认；CLI -D 参数数组。没有证据证明任一现有模块不可达，不为 DELETE 凑项。

## 已确认问题与未知

[FACT] 描述累积不符 getDescription；[FACT] declared range 同时驱动所有消费方；[FACT] DOM/host 双份 step 校验；[FACT] QuickFix 不读 context；[FACT] Preset apply 合并旧覆盖。后者是否应改行为需先复现并获得确认。[RISK] Preset read/write 竞态、Source WorkspaceEdit 异步时序、native 字符长度与引号 lexer、模型自动选工具均不得说已验收。

上游依据均来自固定子模块源码：CommentParser.cc:getDescription/getComment/collectGroups/collectParameters；comment_parser.y 与 comment_lexer.l；ParameterObject.cc:parseNumericLimits/parseEnumItems/importValue；ParameterSet.cc:readFile（NFC）。精确 native 运行结果另存 compatibility ledger，尚未运行标 Unverified。

## Phase 0 官方差分补充

已执行 `node scripts/customizer-native-audit.mjs <managed-700816722/bin/openscad> docs/customizer/native-before.json`，30 例 CLI `.param` 投影差分，20 MATCH / 10 DIFF。这不是 30 项验收通过：runner 保留差分而不把它当进程失败。10 例具体 native/IDE 快照见 JSON。运行时 2026.11-RC0，build commit `9ba0cee7c94785fac0ca8dfe040b965a12a25ed1`，不是 pinned binary；`git -C sources/openscad diff 9ba0cee bcf45a22 -- src/core/customizer src/io/export_param.cc` 输出为空，证明这些参考实现文件相同，不证明整台 pinned 可执行程序已验收。

Native string-length probe 返回 `maxLength=3`，即使 initial=`abcdef`；不得凭 StringParameter 构造函数的表面意图改成扩展长度（该构造函数对同名形参赋值，成员未被扩展）。文本长度仍按已观测行为，Unicode/native 导入截断另验证，禁止未经确认截断用户值。

Before 完成度更新：description、effective numeric range、same-line brace/multi-assignment、NFC、hex Hint 均为 Broken（已观察到差分）；字面量/枚举/组基本行为 native 投影通过，但未覆盖全部边界，仍 Partial。Preset partial 覆盖仍待专用复现，不先宣称缺陷。

## 续作证据索引

详细逐编号门槛见 [customizer-acceptance.md](customizer-acceptance.md)。新增严格 native 兼容门明确失败 10/30，避免覆盖测试被误作正确性通过；新增真实 Host Undo/Redo、设置/保存/实际文档关闭后释放验证，最终 27 项 Host 通过。未把关标签后仍缓存的磁盘 TextDocument 当产品缺陷。公开语义与 Preset 行为修正仍等确认；本轮没有绕过这一门槛。
