# SCAD AI IDE — OpenSCAD Customizer 架构优先完整审计与重构 SPEC（V2）

**SPEC ID**: `SCAD-CUSTOMIZER-ARCH-FIRST-V2-2026-11-09`  
**状态**: Implementation Specification（源码事实已抽样核对；**完整架构/功能审计必须由 Codex 在编码前完成**；代码尚未修改）  
**目标执行者**: Codex / GPT-6.1 Sol / Medium reasoning  
**仓库**: `peterisdev42/scad-ai-ide`  
**锁定基准**: `main@4463d61046d962a3f5afa5ace49b21f37e6cc4a6`  
**上游对照**: `sources/openscad@bcf45a22caa954ca56ca287994cb6dbc368c67b2`（本次读取的 main 子模块 Git SHA）  
**目标 VS Code**: 扩展现有 `engines.vscode: ^1.140.0`，不得擅自提高最低版本。  
**优先级声明**: 目标架构合理性、官方语义正确性、功能完整性、用户体验、安全与可测试性，均高于历史代码复用率。**允许重构/替换/删除现有任何内部实现**；已有代码、文件、类、函数、目录结构不构成技术方案的限制。若确有必要，公共接口也可升级，但必须提供迁移和兼容性论证。
**证据分级**：标注为 `[FACT]` 的代码事实来自锁定提交；`[RISK]` 代表需验证的设计风险而非确认 Bug；`[REQUIRED]` 为实施与验收要求。禁止把规格建议当作已实现功能或把文档中的历史测试记录当作本次测试结果。

---

## 0. Codex 执行总指令：先全面审计，再选最佳架构

> **不要以“尽量少改已有代码”为优化目标。** 按照业务需求和官方 Customizer 契约审视所有现有实现，允许拆分、合并、重新组织、重写或删除模块。先提供现状审计报告、目标架构方案、迁移与测试计划，再开始实现。完成后必须交付真正的源码变更、测试与验收结果，而不是只产生设计文档。

### 0.1 不可颠倒的执行次序

1. **审计仓库真实状态**：`git status`、HEAD、子模块版本、当前文件及所有入口；不得覆盖用户未提交修改；与锁定基准不同必须做差异分析。
2. **审计已实现功能的完整性**：明确 `implemented-and-verified / implemented-but-incomplete / incorrect-or-inconsistent / dead-or-unreachable / unimplemented / not-verified`；代码存在不等于功能可用。
3. **审计架构质量**：职责边界、领域模型、扫描/语法分析、状态和生命周期、一致性、错误分类、用户界面、扩展性、安全、性能、耦合、测试和打包可达性。
4. **决定目标架构**：对每一模块明确 `KEEP / REFACTOR / REPLACE / DELETE / NEW`，评价至少两种合理方案并说明取舍；优先选择可维护、可验证、低耦合的设计。
5. **设计迁移路径**：内部代码可大幅修改；对 VS Code 用户配置、扩展激活点、Tool 调用、Preset 文件、公开命令及诊断 ID 等现有外部消费方给出兼容性/版本迁移策略。
6. **分阶段完成实现**：每次合并应保证核心能力可构建并测试；允许先重构后补功能，不必沿原文件布局逐项打补丁。
7. **全链路验收**：上游差分、单测、集成、真实 Extension Host、GUI、Agent、VSIX 和跨平台；环境不可用标 `NOT RUN`，绝不虚报。

### 0.2 允许改变与必须保护的边界

| 可以改变（必要时甚至整体重写） | 必须保护，或有批准的迁移方案 |
|---|---|
| `src/core/customizer/*` 模块边界、类、接口、数据结构、扫描算法、文件布局 | 官方 Customizer 语义与目标 OpenSCAD 版本真实行为 |
| 内部 Parser / Tokenizer / AST / 语义层与规则引擎的具体实现技术 | 用户现有 `.scad` 文件、代码含义、几何行为和普通注释 |
| Analyzer、Validator、Editor、Fix Planner 的分拆/合并/替换 | 明确、低噪音的诊断政策；已有合法语法不得产生回归误报 |
| 现有 GUI 的视图组织、状态管理及 Webview 实现 | 用户已保存 Preset、运行时 Overrides、参数操作语义和可用性 |
| Agent Tool 内部服务、SDK 封装及 Skill 组织 | Agent 显式的信任/确认/工作区边界、过期防护、编辑事务和失败报告 |
| 测试框架、fixtures 与代码生成架构 | 已发布 Tool/命令/配置的可接受迁移策略、VS Code 版本支持边界 |
| 目录结构及不再必要的历史代码 | 未提交源代码、不被暗中保存/修改的文件、可撤销的用户编辑 |

**注意**：不是强制保留“一个 Parser 文件”，而是要求**一个权威的 Customizer 语义契约**。Tokenizer、增量语法分析、语义归一化器、兼容性适配器可分别存在；禁止多个模块各自猜测相互矛盾的 Widget 与约束规则。

### 0.3 架构原则

- **结构依职责设计，不依现有目录设计**：core 领域逻辑不依赖 VS Code、Webview、Agent harness；主机边界用 adapter 注入。
- **统一语义而不是统一实现文件**：GUI / Problems / Code Actions / Preset / Agent 读取一致的语义模型或受控投影。
- **观察和修改分离**：只读分析、明确目标验证、编辑计划、实际提交、运行时 Overrides 分别管理。
- **外部行为兼容优先于内部 API 兼容**：对确需调整的已有外部接口先提供变更影响清单、兼容窗口与测试。
- **正确性优先于测试绿灯**：不得为了适应旧测试而保留已证实错误的语义；改变行为时更新契约测试并记录差异。
- **安全边界是需求，不是旧代码实现形式**：可重构安全模块，但必须保留并验证等价或更强保护。
- **不盲目过度设计**：只有经实际使用场景证明有必要时才引入额外抽象或外部依赖。

### 0.4 项目阶段

`Phase 0 现状/完成度/架构审计` → `Phase 0.5 目标架构 ADR 与迁移方案` → `Phase 1 语义层重构与兼容性` → `Phase 2 诊断/安全修改/GUI 一致性` → `Phase 3 Preset/Agent/文档完整性` → `Phase 4 验收与删减清理`。

**阻断条件**：未形成 Phase 0、0.5 的具体结论，不能直接开始大量实现；除非为阻断性故障作临时修复，且必须记录。Codex 不能以“现有实现已存在”为完成依据。

## 1. 事实依据和源码盘点

### 1.1 固定参考

- SCAD AI IDE HEAD: https://github.com/peterisdev42/scad-ai-ide/commit/4463d61046d962a3f5afa5ace49b21f37e6cc4a6
- OpenSCAD 官方 Customizer 手册: https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer
- 上游 parser: https://github.com/openscad/openscad/blob/bcf45a22caa954ca56ca287994cb6dbc368c67b2/src/core/customizer/CommentParser.cc
- 上游控件语义: https://github.com/openscad/openscad/blob/bcf45a22caa954ca56ca287994cb6dbc368c67b2/src/core/customizer/ParameterObject.cc
- 上游 annotation grammar/lexer: `src/core/customizer/comment_parser.y` 和 `comment_lexer.l`，同一子模块 SHA
- 上游 JSON parameter sets: `src/core/customizer/ParameterSet.cc`，同一子模块 SHA
- VS Code LM Tool API: https://code.visualstudio.com/api/extension-guides/ai/tools
- VS Code 扩展贡献点: https://code.visualstudio.com/api/references/contribution-points
- VS Code Agent Skills: https://code.visualstudio.com/docs/agent-customization/agent-skills

**事实冲突时的优先次序**：目标版本的 OpenSCAD 可执行程序/上游实现及可复现测试 > 官方手册明确条款 > 当前 IDE 静态 Parser 行为 > 第三方 Customizer 示例。不要在未跑目标版本时假定每个旧版/开发版都有相同表现。手册是规范参考，但不是所有边界的形式化语法。

### 1.2 已有代码——审计对象，不是保留指令

| 路径 | 当前代码事实（需复核） | 审计重点/可能的处置 |
|---|---|---|
| `src/core/customizer/CustomizerParser.ts` | `parseLiteral`、`splitOutsideStrings`、`scanCustomizer`、`parseCustomizer`、`numericStep`；GUI 与分析器共享扫描；字面量/数值向量/分组/前置位置/重复赋值处理 | 验证与上游一致性、扫描可靠性、职责耦合和复杂度；可重构/替换，并提供调用方迁移 |
| `src/core/customizer/CustomizerSourceAnalyzer.ts` | 当前源码只针对**有效声明的显式控件注释**生成警告；代码包括 `MALFORMED_HINT`、`INVALID_RANGE`、`INVALID_CHOICES`、`DEFAULT_OUT_OF_RANGE`；有具体 `suggestedFix` | 增加结构化 Rule ID、证据、Fix 元数据、细分检查；保留保守默认语义 |
| `src/core/customizer/CustomizerSourceTypes.ts` | `CustomizerDiagnostic`、分析输出、预期控件和 Source Edit Intent 类型 | 先区分内部/外部 API；允许重新设计内部类型，对外做明确迁移 |
| `src/core/customizer/CustomizerSourceValidator.ts` | `semanticPass`、`checked/matched`、`expectationResults`、诊断与完成度；未满足目标不会被报告成源代码诊断 | 独立返回契约、源码、完整性状态，审查其语义是否把源码、契约和质量门槛错误耦合；必要时重新设计并提供兼容投影 |
| `src/core/customizer/CustomizerSourceEditor.ts` | 语义编辑计划；保留 CRLF、BOM、几何和相邻代码；拒绝多声明、表达式和歧义注释 | 评价规划算法正确性、最小补丁、群组副作用与复杂度；可替换，但安全和后置验证不可退化 |
| `src/features/language/CustomizerDiagnostics.ts` | 独立 DiagnosticCollection；200ms debounce；开/改/存/关闭/设置变更处理；启用开关 | CodeAction 关联和元数据完善，配置及关闭时保持清理 |
| `src/features/language/CustomizerCodeActions.ts` | 提供少量 Quick Fix 和 RefactorRewrite；经 `planCustomizerEdits` 校验 | 审计临时正则与 Rule 的耦合、是否覆盖所报告问题；允许重写 Rule → Fix 机制 |
| `src/features/sidebar/CustomizerSourceDomainService.ts` | Agent Source Analyze/Plan/Commit/Validate；URI+version+SHA256 CAS；120 秒一次性计划；未保存缓冲区编辑；Workspace Trust/路径验证/中止 | 可重构事务/身份/确认机制，但安全能力必须等价或更强；审计异步时序 |
| `src/core/customizer/CustomizerService.ts` | `validateValue`/override/CLI `-D`；GUI 和 Agent 共用 | 对齐已确认的有效约束，防止 GUI/工具与解析结果分歧 |
| `media/customizer/main.js` | 渲染 Dropdown、Checkbox、Vector、Slider、Textbox；Global 参数放在树根，普通分组折叠显示 | 审计 UI 信息架构、易用性、无障碍、分组语义及与上游差异；可保留也可重设计 |
| `src/core/customizer/CustomizerPresets.ts` | 官方字符串编码式 Preset 解析、解码、类型验证；允许保留额外 JSON 字段 | 审计并可重构/替换整个 Preset 解析与验证边界；不能把官方 JSON 编码值当成强类型 Agent Tool 参数 |
| `src/features/sidebar/CustomizerPresets.ts` | Preset I/O、文件监听、合并写、导入导出、覆盖保护 | 评估生命周期是否正确；允许重构 I/O 与 watcher，保证原始数据无损和原子性 |
| `src/features/agents/registerCapabilities.ts` + `src/core/capabilities/catalog.json` | 注册 `customizer.sourceAnalyze`、`sourceApply`、`sourceValidate` 和参数/预设工具 | 核验 Tool 是否真实可用及能力闭环；外部名称优先兼容，若必要可迁移并更新 catalog/生成物 |
| `instructions/openscad-customizer.instructions.md` | 已贡献 `.scad` 专用指令 | 审查触发范围、与 Skill 冲突、token 成本与实测可用性；可调整资源布局 |
| `skills/openscad-customizer-authoring/` | 已有 Skill + syntax/examples/pitfalls | 审计内容缺口与自动引用有效性；按任务边界重组，避免重复 |
| `skills/openscad-customizer/` | Overrides/Presets 工作流 | 审计与 Source Authoring 的任务分工、用户请求误路由风险及端到端可用性 |
| `scripts/agent-manifest.mjs` | 自动生成 `package.json` 的 `languageModelTools`、资源清单、能力矩阵与 GUI Agent 合约 | 审计生成链的维护成本、正确性和 VSIX 打包；可改生成架构但需稳定外部注册 |

现有验证命令：`npm run test:customizer:source`、`npm run test:customizer`、`npm run test:capabilities`、`npm run test:integration`、`npm run check:agents`、`npm run check-types`、`npm run lint`、`npm run package`、`npm run verify:agents:vsix`、`npm run test:agents:installed`。依赖实际环境的测试应记录 SKIP/NOT RUN。

### 1.3 近期修复的政策——不得回退

`main@4463d610` 的 commit 是 `fix: eliminate misleading Customizer diagnostics`。其 `CustomizerSourceAnalyzer.ts` 只在最终有效、可识别的参数上检查**明确写出的 Hint**。这是本 SPEC 的硬性约束。

默认 `Problems` **不得**因为以下合法/无害行为给出诊断：没有 Slider 注释；计算变量/表达式默认值；5 元素以上向量作为普通变量；Hidden/Global 分组；有效重复赋值；前一个声明被覆盖；Dropdown 未列出的默认值（上游会加入备选项）；重复选项标签；非步长网格上的默认值；有意不给描述；普通尾注；错误/不受支持的控件意图不足以确认时。此类信息可以成为只读 `candidates`、显式 target 检查或按需“审查报告”，但不能默认制造警告。

`sourceValidate` 已有 `expectationResults`：用户要求的控件没有创建成功，是**contract mismatch**，不是普通 SCAD 源码语法错误。工具返回 `ok=true` 也不等于 `semanticPass=true`。

## 2. 全覆盖目标与验收范围

### 2.1 最终交付目标（不是对已有代码做增量补丁）

1. **完整、官方兼容的 Customizer 领域模型**：明确扫描/字面量/注释语法、有效声明、控件、显式和有效约束、组、隐藏、默认值、描述、候选与不确定性。
2. **可信诊断系统**：高置信度且低噪音，准确定位，提供可理解、可执行的修复建议；区分真正源码问题、用户目标不满足和可选风格审查。
3. **统一安全修复系统**：对局部可证实问题提供 Quick Fix；非确定操作展示候选与预览；所有源码修改可回滚、抗并发、事务性明确。
4. **功能完整的 Customizer GUI**：控件显示/编辑/校验/分组/描述/状态同步/错误提示/键盘操作/无障碍/空状态都可正常工作；与 Agent 共享相同的业务语义。
5. **官方格式兼容的 Presets**：读写、导入、应用、增删、部分参数、历史数据、未知参数、外部文件变更、并发状态与 Preview 一致。
6. **面向 VS Code 原生 Agent 的可靠知识与工具链**：任务能发现规则、生成源码、保留原逻辑、校验预期、必要时修复并如实报告未验证项。
7. **质量与维护性**：平台无关领域内核、边界清晰的 adapter、可复用 fixtures、足够的单元/集成/E2E 测试、可观测的失败结果、无死代码和不必要复杂度。

### 2.2 逐项完成度审计是强制要求

对 **每个能力** 记录以下状态并提供实证：`Complete`、`Partial`、`Broken`、`Unreachable`、`Missing`、`Unverified`。即便已经写有单元测试，也必须检查测试是否证明确实被激活、通过 UI/Tool 调用、打包进 VSIX 并在真实 Extension Host 可用。除第 14 节审计矩阵外，还需检查跨功能调用链及故障/取消/并发路径。

### 2.3 任务边界

本次以 Customizer 能力完整闭环为边界，不重新实现 OpenSCAD 编译器、CAD 几何引擎或 VS Code 通用 Agent。允许调整依赖基础设施、源文件架构和预览适配层，以修复 Customizer 闭环问题。**非目标不是保留错误代码的理由。** 如果官方行为必须通过真实 OpenSCAD CLI/桌面验证而运行环境不可用，要记 `Unverified`，而不是硬编码猜测。

## 3. 上游语法契约（实现与测试依据）

| 输入 / 规则 | 上游文档/实现支持的行为 | IDE 本次要求 |
|---|---|---|
| `width = 40;` | 主文件且第一个有效 `{` 前的数字字面量是可编辑数值参数 | Spinbox，无错误/警告 |
| `w=40; // [100]` | 数字 Slider，单最大值；当前上游范围下界按 0 处理 | 保留单上界语义；不要警告“未写 min” |
| `w=40; // [10:100]` | Slider 有 min/max | 正确提取和验证范围 |
| `w=40; // [10:5:100]` | 带显式 step 的 Slider | 解析为三项，无错误；无须强制默认值落在网格上 |
| `w=40; // .5` | 数值 Spinbox 显式 step | 支持浮点与科学记数边界（经上游核验） |
| `color="red"; // [red,blue]` | 字符串枚举 | 保留类型及选项，合法时无警告 |
| `quality=2; // [1:Draft,2:Fine]` | 数值 + 标签枚举 | 值/标签分离 |
| `enabled=true;` | Checkbox | 无 Hint 也有效；不给“缺少 Hint”提示 |
| `name="Part"; // 20` | 字符串长度 Hint；手册提示旧版行为可能变化 | 按版本验证真实含义，明确是长度限制而不是随意猜测 |
| `size=[1,2,3,4]; // [0:10]` | 1–4 数字分量 Vector | 四项内支持，共用约束；普通超长列表保持安静 |
| `/* [Dimensions] */` | 分组 | 以单行 block comment 建立后续组 |
| `/* [Global] */` | 上游 Desktop 在各 Tab 展示全局值 | 目前 IDE 树形展示在根节点，可保留，但清楚标记为 UI 表现差异 |
| `/* [Hidden] */` | 后续参数隐藏，直到下一分组 | 不产生任何默认警告 |
| 首个 `{` 后赋值 | 不被标准 Customizer 展示 | 只在显式 target 验证或明确的迁移请求中提示，不默认报警 |
| `r = width/2;` | 合法 OpenSCAD 表达式，不是可编辑 Customizer 字面量 | 保持静默，不能常量折叠作自动修复 |
| 多次赋值 | OpenSCAD 合法，通常后一次影响有效声明 | 按最终有效声明判定参数；被覆盖的旧 Hint 不能继续报错 |
| Range 越界默认值 | 上游 `ParameterObject::parseNumericLimits` 会记录 Warning 并调整 **有效** min/max 以包含默认值 | 区分 `declaredRange` 与 `effectiveRange`；经真实运行时测试后修复 IDE 当前不一致；切勿静默夹断默认值 |
| Dropdown 默认值不在列表 | 上游 `parseEnumItems` 会在列表前插入该默认值 | 不作为默认警告；GUI、Agent 与 Preset 需要理解真实选项 |
| Preset JSON | `parameterSets`、常见 `fileFormatVersion: "1"`、字符串编码的参数值、允许部分参数 | 使用独立 Preset 验证；禁止把所有字符串值直接判为错误 |

**上游精度边界**：`comment_parser.y` 与 `comment_lexer.l` 的语法不等价于完整 SCAD 字面量语法，例如注释中的某些字面量表示法不同。对 Hex、转义字符、Unicode 正规化、逗号/冒号/括号位于引号中的情况，应以 pinned 上游和可执行版本的差分 fixture 结论决定是否支持。不能因为 JS `parseLiteral` 支持一个形式就断言上游 Hint 同样接受。

## 4. 架构决策规范（候选架构，不规定最终目录）

### 4.1 建议的职责分层与数据流

以下是 **可比较的候选架构**，Codex 必须在 Phase 0.5 给出保留/修改/替代意见，而不是直接视为指定目录：

```text
OpenSCAD Source (current unsaved document, explicit file)
       │
       ▼
[Source Lexer / Scanner]    ← offset/UTF-16/CRLF/quoted delimiters/brace state
       │
       ▼
[Customizer Semantic Analyzer] ← upstream compatibility profile + effective declarations
       │
       ├── [Semantic Snapshot] ─────────────┬── Customizer View Adapter (Webview)
       │                                    ├── Runtime Overrides + Preview Adapter
       │                                    ├── Agent Analyze + Validate Adapter
       │                                    └── Preset Binding Adapter
       │
       ├── [Source Diagnostic Rules] ─────────── VS Code Problems Adapter
       │                                    └── Rule-aware Fix Suggestions
       │
       └── [Contract Validator] ─────────────── Agent expectationResults / user-requested check
                                             (NOT generic Problems)

[Edit Intent / Fix Request] → [Edit Planner + Source Guard] → [Preview + Postcondition]
                                     │
                                     ▼
                        [Version/Hash/Trust/Workspace CAS]
                                     │
                                     ▼
                       [Atomic WorkspaceEdit / Undo]
                                     │
                                     ▼
                         [Fresh Semantic Revalidation]

[Preset Parser / Validator / Transactional Storage] ↔ [Semantic Snapshot]
[VS Code Agent Instructions / Skills] → use public Tool contract, not new authority
```

**不要求按图建 10 多个类**：只要语义正确、职责清楚、耦合与维护成本更低，合并某些组件也合格。反之现有 `CustomizerParser.ts` 的职责过多时，可以拆出 tokenizer、literal parser、annotation parser、visibility resolver、semantic normalizer；关键是规则的唯一权威性和可测试性。

### 4.2 统一领域对象建议（仅示例，接口可重新设计）

```ts
interface CustomizerParameterSemantic {
  identity: { name: string; sourceRange: SourceRange };
  visibility: 'visible' | 'hidden' | 'superseded' | 'unsupported';
  group: string;
  defaultValue?: unknown;                 // 经安全字面量解析的值，不求值表达式
  widget?: CustomizerWidget;
  declaredConstraints?: {
    range?: { min: number; max: number; step?: number };
    choices?: Array<{ value: string | number; label: string }>;
    maxLength?: number;
  };
  effectiveConstraints?: unknown;       // 上游真实语义；确认后定义强类型
  description?: string;
  evidence: 'native-verified' | 'documented' | 'inferred' | 'unknown';
}
interface CustomizerSnapshot {
  document: { uri: string; version: number; sha256: string };
  complete: boolean;
  incompleteReasons: string[];
  parameters: CustomizerParameterSemantic[];
  candidates: unknown[];
}
```

允许将 Domain 类型与 VS Code/Agent 的 DTO 分离，避免每次内部架构迭代波及 Tool schema。`declaredConstraints` 与 `effectiveConstraints` 的区别应落实到 Preview/GUI/Overrides 的实际校验，不只是增加两个字段。以目标 OpenSCAD 版本的实测行为为准。

### 4.3 必须评估的架构决策（ADR）

| 决策 | 至少比较的方案 | 判断标准 |
|---|---|---|
| 词法/语义分析 | 现有单文件扫描器增强 vs 分层 tokenizer/semantic analyzer | 正确性、可定位性、边界输入、可测试性、复杂度 |
| GUI schema | 现有 `Parameter` 直接传递 vs 独立稳定 view-model | UI/CLI/Agent 语义一致、状态变更效率、向后兼容 |
| 约束计算 | 直接范围 vs declared/effective 双层语义 | 上游差分、用户默认值与输入行为一致 |
| Rule Engine | `if` 组合 vs 独立 Rule Registry + Fix Strategy | 规则数增长、误报测试、映射一致性 |
| 编辑实现 | 现有 piece 追踪算法 vs 文本 edit planner / token aware rewrites | 最小变更、幂等、跨组保护、可撤销、安全证据 |
| 状态管理 | 当前 DomainService + ViewProvider vs 减少耦合的 Controller/Store | 响应性、取消、生命周期、并发和未保存文档 |
| Preset | 现有解析/I/O vs 独立业务事务与诊断 | 数据无损、部分覆盖、状态回滚、Schema 兼容 |
| Agent 结构 | 现有多工具 + Skill vs 改善 DTO/Tool 描述/资源分层 | 真实模型工具选择、成本、兼容性、成功验收 |

**ADR 输出**：每项含当前问题证据、备选方案、所选方案、舍弃理由、影响接口、迁移和测试。不能因为“已经存在”而选择保留，也不能为了“架构好看”而无理由重写。

### 4.4 诊断 / Contract / Preset / OpenSCAD 编译错误不混同

- **Source Diagnostic**：仅针对书写明确、最终有效的 Customizer 注释缺陷；默认低噪音；不能将合法语言行为当错误。
- **Explicit Contract**：用户要求有 Slider/分组/描述/选项等，结果缺失，属于业务目标验证，不注入全局 Problems。
- **Preset Validation**：针对关联 `.json` 数据结构和值合法性，有自己的 Error/Warning/Info 与修复建议。
- **OpenSCAD Compiler / LSP**：正常语法错误保留给编译器/语言服务；必要时去重或汇总来源，不能重复刷屏。
- **Compatibility Assessment**：未验证的上游差异是报告/候选，不默认生成语法错误。

### 4.5 外部兼容与内部自由

- 先盘点扩展激活点、commands、configuration、Language Model Tools、生成式 catalog、Skill paths、Customizer 的 webview 消息协议、Preset JSON 与用户本地状态。
- 旧内部 TypeScript API、类名、文件位置、实现方式可变；测试应验证外部行为而非冻结所有内部结构。
- 现有 `sourceAnalyze/sourceApply/sourceValidate` 等**外部 Tool 合约原则上尽量兼容**；若现有设计确实妨碍能力完整性，允许发布新版本接口，并通过 alias、deprecation、转换 adapter 或显式 breaking change 计划处理。
- 不允许无方案地删除持久化用户数据、确认/信任机制或已有已发布命令；不允许静默改变 `sourceApply` 修改范围和磁盘保存语义。

### 4.6 事实与未知分层

每个语义判断应追踪 `source / native reference SHA / test fixture / verification status`；需要 native 对照而未验证的规则不得升级成高严重度诊断。兼容 profile 可为逻辑模块而非必须是可配置类。外部执行命令不得被当作解析库嵌入每次键盘输入；保持编辑实时响应。

## 5. 诊断规则目录（P1 必须实现的部分）

**Severity 政策**：OpenSCAD 的普通语法错误由语言服务器处理；不将 Customizer 注释解析失败冒充 OpenSCAD 编译错误。默认源诊断以 Warning 为主；Error 仅针对确定的 Preset JSON 结构错误或另一个独立 Contract Validation 的失败结果，而不是因缺少 Customizer 注释产生 Error。所有默认 Warning 必须满足：**明确写出的最终有效控件 Hint + 可证明的问题 + 可操作的修复**。

### 5.1 默认启用的高置信度源码规则

| ruleId | 旧 code / 新 code | 触发证据 | 默认 | 用户可见错误/警告与修复建议 | 自动修复策略 |
|---|---|---|---|---|---|
| CUST-ANN-01 | `CUSTOMIZER_MALFORMED_HINT` | 明确写出的范围/枚举 Hint，且缺少未在字符串中的 `]` | Warning | “此控件注释缺少闭合 `]`；请补全引号/方括号，或移除未完成的控件 Hint。” | 仅在唯一可确认时 Safe；有其他尾注时 Review |
| CUST-ANN-02 | `CUSTOMIZER_MALFORMED_HINT` | 数值 Hint 是 0 或负数，且被明确识别为 Spinbox 步长 | Warning | “显式步长无效；请输入正数，或移除步长注释。” | Safe：删除纯步长注释；不猜新步长 |
| CUST-RANGE-01 | `CUSTOMIZER_INVALID_RANGE` | 完整的三/两项显式数值范围，min > max，且目标版本验证该约束不合用 | Warning | “声明最小值大于最大值；请确认并修改边界。” | Review，不能自行交换工程意义 |
| CUST-RANGE-02 | `CUSTOMIZER_INVALID_RANGE` | `[min:0:max]` 等显式不可用步长 | Warning | “显式 Slider 步长为 0；请移除 step 或填入经用户认可的正值。” | Safe：保留 min/max，删除 step |
| CUST-ANN-03 | `CUSTOMIZER_INVALID_CHOICES` | 完整明确的枚举 Hint 存在空的枚举项（例如 `[1,,2]`） | Warning | “枚举包含空选项；删除多余逗号或补充选项值。” | Safe：仅多余逗号唯一可判定时 |
| CUST-TEXT-01 | `CUSTOMIZER_MALFORMED_HINT` | 字符串长度 Hint 明确写了负数或非整数数值 | Warning | “文本长度要求非负整数；请修改长度或移除 Hint。” | Review |
| CUST-TEXT-02 | `CUSTOMIZER_DEFAULT_OUT_OF_RANGE` | 明确声明文本长度且默认字符串长于其长度 | Warning | “默认文本长度超过声明限制；请选择扩展长度或缩短默认文本。” | Review；不得默认截断 |
| CUST-RANGE-03 | `CUSTOMIZER_DEFAULT_OUT_OF_RANGE` | 明确数值 Range，但默认数值越界 | Warning | “默认值超出所写范围；上游可能扩展实际控件边界，请检查范围与默认值。” | Review；不得擅自夹断/改变几何 |
| CUST-ANN-04 | 新 code（若实现） | 明确封闭的控件 Hint 含未闭合引号，且扫描器能证明没有普通文本替代解释 | Warning（仅证据充分） | “选项字符串未闭合；请闭合引号或移除该 Hint。” | Review；支持 `]` 在引号中的负例 |
| CUST-ANN-05 | 新 code（若实现） | 明确数值范围含无法解析项，且不是注释说明、字符串枚举或普通文本 | Warning（仅证据充分） | “该范围不是有效的数值范围；请使用 `[max]`、`[min:max]` 或 `[min:step:max]`。” | Review，不乱猜值 |

**必须通过的反例**：`a=1; // [0:22] IDs in Assembly.md; 0 shows the selected group`，当前 Parser 把它当普通/不支持的整条尾注，不识别 Slider，且绝不能误报“缺少 ]”。建议指导用户把解释移到上一行，但默认不报警；`name="x"; // ["x]":Label` 的 `]` 在引号里，不能算闭合 Hint。任何包含 `]`、`:`、`,` 的普通文档说明都不应靠单个正则粗略认定为控件。

**范围策略**：若上游对负 step 或反向范围仍能接受，保留当前 `INVALID_RANGE` 检查作为 IDE UI 的“约束冲突提示”，而非 OpenSCAD 语法错误；确切行为记录在兼容性 fixture 中。用 `(ruleId, severity, message)` 区别插件自身约束与上游 parser 失败。

### 5.2 默认绝不报警的场景（固定负例）

| 输入 | 默认诊断 | 原因 |
|---|---|---|
| `width=40;` | `[]` | 数值 Spinbox 合法，无须提供 Hint |
| `radius=width/2;` | `[]` | 合法计算表达式 |
| `radius=width/2; // [0:100]` | `[]` | 不支持的 Customizer 默认值不是 OpenSCAD 语法错误 |
| `width=40; // width between 10 and 100` | `[]` | 普通说明文字不是显式可解析控件 Hint |
| `width=40; // [0:22] IDs in Assembly.md` | `[]` | 关闭的括号后还有普通解释，非完整 Widget Hint |
| `width=10; width=20;` | `[]` | 合法重复赋值，按有效声明判断 |
| `width=10; // [10:0:100]\nwidth=30; // [0:100]` | `[]` | 旧注释已被覆盖，不应诊断 |
| `size=[1,2,3,4,5];` | `[]` | 不支持作为控件不代表语言错误 |
| `shape="x"; // [y,z]` | `[]` | 上游会加入默认 x |
| `quality=1; // [1:One,1:Also One]` | `[]` | 重复选项/标签不是必然解析错误 |
| `width=12; // [0:5:100]` | `[]` | off-step default 不默认警告 |
| `/* [Hidden] */\ninternal=10;` | `[]` | 隐藏是设计意图 |
| `module m() {}\nlate=10; // [0:20]` | `[]` | 不显示不等于应该报错 |

### 5.3 显式契约失败（只出现在 Agent validate / 请求式审查）

| contract issue | 显式要求 | 实际状态 | 指导与修复 |
|---|---|---|---|
| `TARGET_MISSING` | 必须有 `width` | 未声明 | 在主文件添加独立字面量参数，先确认是否与已有变量冲突 |
| `EXPECTED_VISIBLE` | 必须可见 | Hidden / 首个 `{` 后 | 建议移动到可编辑区域或修改分组；需评估作用域变化 |
| `EXPECTED_LITERAL` | 必须是 Slider/Spinbox | 最终值为表达式 | 保留计算逻辑，新增独立可编辑输入；不要自动算常量 |
| `EXPECTED_WIDGET` | 必须 Slider | 实际 Spinbox/Dropdown | 给出实际 Widget、需要的 Hint 和未满足属性 |
| `EXPECTED_TYPE` | 必须数值 | 实际字符串 | 不自动修改默认类型或模型消费者 |
| `EXPECTED_RANGE` | 指定最小/最大/步长 | 实际不同 | 按调用者传入的具体数值规划修复 |
| `EXPECTED_CHOICES` | 指定枚举值/标签 | 实际不同 | 显示差异，保留现有默认值，需核实选择逻辑 |
| `EXPECTED_GROUP` | 需要 Dimensions | 实际 Other | 提供分组迁移计划，不能改变其他参数分组 |
| `EXPECTED_DESCRIPTION` | 必须有描述 | 未识别到 | 使用第一列紧邻描述注释；验证重新解析结果 |

每个 `expectationResults[]` 应提供稳定 `issue.code`、可读 message、`range`、可选建议 fix，而非只能有自由文本字符串。可保留原 `issues: string[]` 兼容旧 Tool，新增 `details?: [...]`。GUI 不得把这些 contract mismatch 自动发布到 Problems，除非用户主动调用专用“验证目标”命令并明确选择展示。

## 6. Parser 与 GUI 的兼容性缺口（P0/P1）

### 6.1 官方差分测试先行，重构范围由完成度与架构审计决定

建立 fixture table：`source`、`expectedNativeParameters`、`expectedIDEParameters`、`diagnostics`、`referenceOpenSCADCommit`、`verificationStatus`。对于已证明的差异，修正 Parser；对于无法运行 native 的边界，标 `unverified` 并避免强制 Severity。

必须检验这些已知风险：

1. **描述范围**：上游 `CommentParser::getDescription` 只读取紧邻上一行、从第一列以 `//` 开始的描述；当前 IDE 扫描器会合并独立注释文本。应依上游证据修正语义并同步迁移 GUI；普通缩进注释/空行隔开注释不作为必然描述。
2. **分组**：单行块注释 `[Tab]`，支持上游文档中不推荐的多 `[]` 名称；不同大小写的 `Hidden`/`Global` 是普通分组。当前 GUI 的 Global 行放在根节点，保留时在用户文档中明确为 UI 表现差异。
3. **有效赋值**：重复赋值、Hidden、首个 `{` 后语句、字符串和注释中的 `{`，包括 `include/use`，都必须使用正确有效声明而非全文件正则匹配。
4. **默认值越界**：上游 `ParameterObject::parseNumericLimits` 会扩展有效范围。IDE 当前 `CustomizerService.validateValue` 和 DOM `input.min/max` 使用声明值，可能导致默认值、控件和 Agent 校验不一致。将 **声明范围与有效范围分离**（建议 `declaredRange`、`effectiveRange`，保留 legacy `range` 暂时不破坏消费方），通过上游对照后同时修改 GUI/Validator/Service，禁止静默裁剪默认值。
5. **枚举**：`parseEnumItems` 支持数字和字符串选项及标签，且默认值缺失时自动补入。`CustomizerParser.annotate` 与 `parsePresetFile` 必须与此一致；不得强制同类型/缺省值包含于枚举的默认警告。
6. **字符串/数字表示法**：`parseLiteral` 支持 Hex、科学记数及 Unicode 转义，注释 Lexer 支持形式可能不同；必须有对比测试。
7. **不完整分析**：单独输出 reason，不由 `[]` diagnostics 误导为无问题；尤其缺右括号、未闭合字符串和超大文件。
8. **字符位置**：UTF-16 行列、CRLF、BOM、emoji、中文标识符、Unicode NFC 的参数匹配，均须复测。

### 6.2 兼容性优先级

- **必须修正**：当前实现与 pinned 上游导致实际 Widget、有效范围、默认值、Description 不一致的确定性 bug。
- **可审议的设计差异**：GUI 树形分组或 Desktop Tab 均可比较；应从 VS Code UX、易用性和可维护性选最佳，而非强制保留现状。
- **不确定时保守**：不得因为纯猜测为旧版/开发版生成新的 Error/Warning。

## 7. Quick Fix / Refactor 策略（P2）

### 7.1 安全等级

- `safe`：唯一、局部、可逆、不会改变参数默认值/工程限制。可以有 Preferred Quick Fix。
- `review`：存在多个合理方案，向用户展示建议或 `RefactorRewrite` 计划；必须有明确操作预览，必要时由用户选择数值。
- `manual`：跨作用域迁移、表达式变成可编辑变量、需要推断模型含义。只返回指导，不执行自动修复。

### 7.2 每条默认 Warning 的最小行动

- `CUST-RANGE-02` `[10:0:100]`：安全移除显式零 step → `[10:100]`；不得发明新的 `5`。
- `CUST-ANN-01` `[0:10`：仅当所在注释纯粹是可辨认 Hint，且不会吞并右侧普通解释时补 `]`。否则只给可读建议。
- `CUST-ANN-03` `[1,,2]`：明确只有多余逗号时删除它；引号、标签复杂时拒绝自动改。
- `CUST-RANGE-01` `[100:10]`：提供待审查选择，不要在没有用户意图时直接对调。
- `CUST-RANGE-03` `default=120; // [0:100]`：提供“扩展边界”或“修改默认值”两个需要审查的方案，不默认改值。
- `CUST-TEXT-02`：保留默认内容，建议增加允许长度或用户确认缩短文本。
- 对普通 `// range: 10..100` 的转换以及添加明确 step/Global：继续作为 RefactorRewrite，**不是**修复源警告。

### 7.3 代码接入

1. `CustomizerCodeActions.ts` 接受 `CodeActionContext.diagnostics` 并按 `Diagnostic.code` / `ruleId` 过滤，避免给未诊断内容提供假 Quick Fix。可选 Refactor 保留为独立动作。
2. 必须存在统一且受控的编辑计划/校验边界；可以用重构后的安全编辑引擎**替换**当前 `CustomizerSourceEditor`，由 Rule Fix Planner 接收诊断 `fixId` + 文档身份生成明确编辑；拒绝无约束 Agent 补丁。
3. 任何 WorkspaceEdit 必须使用当前文档 range，与用户未保存缓冲区一致；保留现有源码版本和 SHA-256 CAS、Workspace Trust、项目真实路径校验、单次提交、120 秒 plan 过期机制。
4. Quick Fix `WorkspaceEdit` 不能绕过已有 planner 的输出后置验证；代码动作可以直接使用已验证的计划快照，但需要在执行时重新判定文档未变化。若 VS Code CodeAction 当前 API 不支持按版本阻止应用，优先使用 `CodeAction.command` 路径进行二次 CAS 校验而不是冒险应用陈旧编辑。
5. 一次修复只改相关范围；普通尾注、几何代码、其他参数、Preset 文件不应变化；修复第二次调用应幂等。
6. 低可信 Hint 分析只给 Guidance，不给代码修改动作；Plan 对不完整分析直接拒绝。

## 8. Preset JSON 验证（P3，分离于 Source Linter）

审核 `src/core/customizer/CustomizerPresets.ts` 与其 I/O、状态、Preview 生命周期的设计和完成度；可重构或替换，在恪守官方数据语义和用户数据无损的前提下增加只读验证。**仅**对当前已绑定/显式选中的 Preset JSON 启用；不能全局扫描任意 `*.json`。`parameterSets` 字段为结构核心；上游允许部分参数集和字符串编码。不要将官方格式中的 `"25"` 当作 type mismatch。

| Preset rule | 严重度 | 诊断与修复提示 |
|---|---|---|
| PRESET-001 INVALID_JSON | Error | JSON 解析失败；显示位置及可用修复（不猜损坏的参数值） |
| PRESET-002 INVALID_STRUCTURE | Error | 根对象/`parameterSets` 不是支持结构；提供官方 JSON 样例 |
| PRESET-003 INVALID_SET | Error | 单个参数集/成员结构与支持格式不兼容；标注 set/key |
| PRESET-004 INVALID_VALUE | Warning/Error（取决于是否正在应用） | 参数值无法解码或不符合该模型；保留原 JSON，指导用户选择适当值 |
| PRESET-005 UNKNOWN_PARAMETER | Information（仅请求式审查） | Preset 中有当前模型没有的参数；可能是历史/其他模型残留，不自动删除 |
| PRESET-006 OPTION_NOT_PRESENT | Warning（仅绑定模型或应用时） | 选项值不被实际下拉识别；列出有效值，不能擅自更换 |
| PRESET-007 VERSION_COMPAT | Information | `fileFormatVersion` 未知/缺失时遵循现有 Parser 与上游差异的兼容策略，不能无证据一律报错 |

规范：在导入/应用前验证全量值并保持事务性；Preview 只在成功完成后接收新覆写；异常时 Preset 原文件、其他 Sets、额外元数据原封不动。任何用户不请求的“清理旧 Preset”不得自动进行。文件外部变更和已有 watcher/revision 机制必须保持。

## 9. VS Code Agent / Skills 增强（P3）

### 9.1 以 Agent 任务闭环而非现有工具数量为目标

首先审计以下已注册工具的完整性、可发现性、实际执行与结果契约；若合理则继续使用，必要时可重构内部或合并/升级接口：

- `scad_ai_ide_customizer_sourceAnalyze`
- `scad_ai_ide_customizer_sourceApply`（plan/commit）
- `scad_ai_ide_customizer_sourceValidate`
- `scad_ai_ide_customizer_state`（真实 GUI 模型状态）
- 既有 `customizer_set/reset/applyPreset/...`（运行时 Overrides 与 Presets）

Tool 的 `modelDescription` 应突出三点：第一，`sourceAnalyze` 中 candidates 不是错误；第二，计划调用必须用原始 identity 且不得在失败后臆造成功；第三，`sourceValidate.expectationResults` 用于“用户想要的控件是否存在”，不能理解为源码 Syntax Error。

调整 Agent 外部注册/生成方式后，运行当前或迁移后的 `generate:agents`、`check:agents`，保证 manifest、`resources.json`、能力矩阵、GUI parity 与实际注册一致，更新相关测试。

### 9.2 审计并优化原生 Agent 资源组织

`instructions/openscad-customizer.instructions.md`（自动文件级提示）：以简短、稳定、低 token 成本为原则；检查 `applyTo` 是否覆盖实际需求而不误触发。可重组文件与路径，更新贡献点。

`skills/openscad-customizer-authoring/SKILL.md`（任务型）：保留现有 Analyze → Plan → Commit → Validate、最大两次定向修复、未保存状态和失败报告；新增引用：

- `references/syntax.md`：经过上游证据校验的控件写法、可见性、分组、数值向量、默认值/Hint 语法。
- `references/diagnostics.md`：Rule ID、触发示例、级别、明确修复与反例，从 Rule Catalog 生成/校验以防漂移。
- `references/compatibility.md`：目标版本、上游 SHA、已验证/未知差异、有效范围与原始范围区别。
- `references/examples.md`：加入正确与错误迁移示例、保留普通说明与 Hidden 的示例。
- `references/pitfalls.md`：明确“缺 Hint、表达式、重复赋值、off-step、缺省选项、普通尾注默认静默”。

`skills/openscad-customizer/SKILL.md` 继续专注 Overrides/Presets；不得将当前参数值修改等同于源码编辑。

### 9.3 Agent 执行协议（跨任何内部架构必须成立）

1. 从当前用户请求提取明确 `SourceExpectation[]`：name/widget/type/group/default/range/choices/visible/description。**缺失的工程范围不能补猜**。
2. `sourceAnalyze` 指定合法 workspace `.scad` URI；读取实际内容/未保存缓冲区及 identity。若 `complete=false`，停止写入并报告需人工处理原因。
3. 仅在明确源码变更需要时使用 `sourceApply(plan)`；检查 preview/postvalidation；commit 仅传服务生成的 `planId`。禁止自行带 approved=true 等“授权”字段。
4. commit 后独立 `sourceValidate`，按 `expectationResults[].matched` 和 `complete` 判断；必要时另读 `customizer_state` 核对 GUI Schema，但仍不能宣称真实 UI 自动化已执行。
5. `ok=false`、`semanticPass=false`、Postcondition Failed、`STALE_SOURCE`、`PLAN_EXPIRED` 必须真实反馈；针对性重试最多 2 次，绝不覆盖较新的编辑。
6. 最终输出要区分源码静态验证、真实 GUI/CLI 验证、未运行项目与保留的用户变更。

VS Code `contributes.chatSkills` / `contributes.chatInstructions` 和 `vscode.lm.registerTool` 是稳定扩展路径；工具展示、Skill 自动触发与实际模型调用依赖宿主 Agent Harness 与当前模型配置。单纯资源打包成功或 `lm.tools` 列表出现不构成真实 LLM E2E 验收。

## 10. 实施路线：架构与完成度驱动，而非现有文件驱动

### Phase 0 — 完整功能审计 + 架构审计（实现前必做）

**任务 0A：仓库事实锁定**。读取当前 HEAD、工作区修改和 OpenSCAD 子模块 SHA，追踪激活/注册到最终 VSIX 的引用链。先跑可运行的现有基线测试；不得把历史测试报告当本次结果。

**任务 0B：功能完成度审计**。逐项完成第 14 节的 Feature Audit Ledger，至少覆盖：官方语法所有控件、参数发现/覆盖/隐藏/分组/描述、诊断规则、定位与误报、Quick Fix、GUI 控件和键盘交互、状态/Preview/Overrides、Preset 全生命周期、Agent tools/skills/commands、Workspace/Remote、安全/性能。**逐个给状态与证据**，代码出现但入口未注册、死代码、打包未包含、Stub、UI 调不到、只在 mock 测试中可用都不能填 Complete。

**任务 0C：设计审计**。完成第 15 节架构质量量表；针对扫描器、语义、状态、异步事务、可测试性、模块依赖、Webview 重复校验和工具接口列具体问题。区别 `[FACT]` 与 `[RISK]`。审计未完成不开始大规模重构。

**任务 0D：官方差分**。用 pinned 上游代码和可用 native 程序验证关键边界；不能运行的项目标 `Unverified`。

**产物**：`docs/customizer-audit.md`、功能矩阵、问题/风险表、测试 baseline、外部兼容性清单。文件名可按仓库文档组织惯例调整。

### Phase 0.5 — 目标架构与迁移 ADR（实现前必做）

1. 至少提出并比较 `渐进重构` 与 `关键模块替换/重组` 两个方案，若有高复杂度风险可给第三方案。
2. 按第 4 节候选数据流设计更合理的目标架构，不以当前 `src/core/customizer` 目录或文件数量为约束。
3. 为所有审计项做 `KEEP / REFACTOR / REPLACE / DELETE / NEW` 决策，说明性能/测试/兼容收益与成本。
4. 列出用户可见外部 API、状态、Preset JSON、Tool schema、快捷命令、VS Code 版本边界的迁移计划。
5. 指定替换、删除旧代码时的验证方法和回滚策略；明确哪些 legacy 测试需要改成“正确的外部行为”契约测试。

**产物**：`docs/customizer-architecture-adr.md`、目标模块图、依赖方向、领域模型、迁移阶段和接口变更表。ADR 写明“为何不选其他方案”。

### Phase 1 — 领域语义与官方兼容性实现

- 按 ADR 重构或替换 Source Lexer/Tokenizer、Customizer Annotation Parser、Semantic Normalizer、有效声明/描述/组/隐藏处理、字面量与坐标逻辑。
- 用单一权威语义描述驱动 GUI、Problems、Agent 与 Preset 绑定，不再在各入口重复推断 range/step/widget。
- 根据官方已验证行为分别建模 declared 与 effective 约束；统一超界默认值、枚举默认值自动插入等语义。
- 维持“源码合法但不可定制”与“注释明确写错”之别；不求值表达式、不执行源代码。
- 迁移既有业务消费者与回归用例；可以删除证实冗余/错误的旧 scanner 实现。

**DoD**：官方差分 fixture 结论可解释、GUI/Agent 参数投影一致、无新增默认误报、未完成或未知明确标注。

### Phase 2 — 规则系统、安全编辑、状态与 GUI 完整性

- 实现第 5 节 Rule Catalog，明确 severity/evidence/range/fix；与 LSP Problems 去重；保守模式默认启用。
- 设计 Rule → Fix Planner；可以重写 SourceEditor 的内部差异/计划算法，但保证最小编辑、幂等、先验和后验校验、版本/哈希/信任/工作区保护与 Undo。
- 重构 Contract Validator，以独立状态/原因报告源码、用户目标、警告和可选兼容性；精确传给 Agent。
- **审查并补齐 GUI 的真实体验**：所有 Widget 的双向值同步与校验、参数分组、Global/Hidden 表现、提示/修复入口、无障碍、键盘、异步状态、空文档/不完整源码、激活切换、未保存文本、Preview 更新。
- 解决确定性的 UI 与核心语义重复校验/边界不一致；可换实现，不强制沿用 Webview 树形架构。

**DoD**：第 11 节正负测试、GUI、CodeAction、Host 真实路径通过；有失败时不错误声明成功。

### Phase 3 — Preset 全生命周期 + Agent 任务闭环

- 全面验证/补齐 Preset Schema、读取、导入、应用、部分参数、历史文件、未知参数、编码解码、写入、外部变化、竞态、失败回滚与 Preview 生命周期。
- 审核现有 Tool 是否真的由原生 VS Code Agent 调用，Tool 入参/结果是否清楚分离源码、Overrides、Preset；必要时修改服务适配与接口版本。
- 用准确的官方语法与 Rule Catalog 重组/补全 Skills、Instructions、示例、预设说明。Skills 被打包和发现不等于真实 Agent 能调用。
- 只引入确有必要的新工具或对现有 Tool 实施迁移；避免第二套语义执行逻辑。
- 维护能力 catalog、生成资源、VSIX 和文档，删除冗余无效资源前先确认没有外部消费者。

**DoD**：Preset 不丢数据、预览值一致；Agent 目标校验闭环有真实证据或明确 `NOT RUN`。

### Phase 4 — 验收、架构清理和可维护性交付

- 执行第 11 节测试矩阵；在真实 Extension Host 中检查 UI/Tool/Problems/CodeActions 与 VSIX 打包。
- 跑回归、性能、兼容性、安全、真实模型和跨平台；缺失条件列出 `NOT RUN` 和阻断因素。
- 搜索死代码、重复规则、未注册功能、旧转换适配、无用依赖；能安全删除的必须删除，外部仍在使用的应迁移后清理。
- 验证模块依赖方向、循环引用、类型边界、错误模型和可维护性；记录复杂度指标，不得为新增功能导致显著代码膨胀而无解释。
- 更新使用文档与工程文档，交付 `before/after` 完成度矩阵、架构改进证据、测试记录及剩余风险。

**DoD**：第 12 节全部核对、用户可见语义完整、已知缺口真实披露；不能仅凭编译通过宣布完成。

## 11. 测试与验收矩阵

### 11.1 必需自动测试

| ID | 用例 | 期待 |
|---|---|---|
| UT-01 | 默认无 Hint 的合法 SCAD | `diagnostics=[]` |
| UT-02 | 表达式/Hidden/超长数组/合法重复赋值 | `diagnostics=[]` |
| UT-03 | 有效声明覆盖旧错误注释 | 旧警告消失 |
| UT-04 | 未闭合 `]` 的真实控件 Hint | 有正确 Warning + 非空具体修复文字 |
| UT-05 | 已闭合 `]` + 尾随说明 | 无假“缺少 ]” Warning |
| UT-06 | 引号内包含 `]`、`,`、`:` 的枚举 | 不被错误切分，控件类型正确 |
| UT-07 | `[min:0:max]` | Warning，安全修复保留原 min/max |
| UT-08 | 越界默认值 | Warning，推荐审查；验证上游有效边界与 IDE GUI 一致 |
| UT-09 | 不在枚举的默认值 | 不报警；实际选项包含默认值 |
| UT-10 | off-step default | 无默认警告 |
| UT-11 | UTF-16/emoji/中文/NFC/CRLF/BOM | 范围准确且原格式不变 |
| UT-12 | `include/use`、注释和字符串含 `{` | 首个有效 `{` 判断正确 |
| UT-13 | Source expectation 不匹配 | `semanticPass=false`，细节在 `expectationResults`，不进 `diagnostics` |
| UT-14 | `includeWarnings=false` | 展示过滤，但底层失败状态不被翻转 |
| UT-15 | 修复后再次应用 | 幂等，没有额外编辑 |
| UT-16 | 过期计划、SHA/version 不匹配、Workspace Trust 缺失 | 不修改源文件，返回精确错误 |
| UT-17 | Preset 仅部分参数、数字字符串、附加字段 | 合法且可保持原数据 |
| UT-18 | 错误 Preset 值、JSON 损坏 | 明确错误，导入/应用不产生半成功修改 |
| UT-19 | 1 MiB、500 参数、诊断截断 | 不越界；`complete=false` 时不可宣称成功 |
| UT-20 | 引入任意普通长尾注 | 不以局部符号生成假警告 |

### 11.2 VS Code Host / Agent 验收

- HOST-01：打开/修改/保存/关闭文档时 Problems 更新和释放正确；设置关闭后完全消失。
- HOST-02：有诊断才提供 Quick Fix；没有诊断时可选 Refactor 不伪装为错误修复。
- HOST-03：固定身份的 Source Analyze → Plan → Commit → Validate 能完成；未保存文本参与分析；磁盘不会被静默保存。
- HOST-04：源代码在 Plan 和 Commit 间变化，返回 `STALE_SOURCE`；原改动不受影响。
- HOST-05：修复后 GUI 参数、Server 状态及 Source Analyzer 实际 schema 一致。
- HOST-06：已有 `customizer.set` 的强类型、目标修订、Preset 读写与 Preview override 没有回归。
- MODEL-01：用真实 Agent 模型按 Skill 创建 Slider/Dropdown/Hidden 参数，然后 `sourceValidate` 契约全通过。
- MODEL-02：模型面对注释尾随说明时不删除用户说明，无法安全修复时解释人工处理。
- MODEL-03：模型面对表达式参数不谎称语法报错、不自动常量折叠。
- MODEL-04：模型 tool 返回 `ok=false` / `semanticPass=false` 时不得宣称成功。

### 11.3 运行命令（按当前仓库 scripts）

```bash
npm ci
npm run check:agents
npm run check-types
npm run lint
npm run test:customizer:source
npm run test:capabilities
npm run test:customizer
npm test
npm run test:agents:ui
npm run package
# 在有合适 VS Code/运行时/可信测试工作区时：
npm run test:integration
# 在构建好对应 VSIX 后：
npm run verify:agents:vsix -- /absolute/path/to/extension.vsix
npm run test:agents:installed -- /absolute/path/to/extension.vsix
```

CI：已有 `.github/workflows/agent-parity.yml` 的 `contracts` jobs 覆盖 Ubuntu、macOS、Windows，`panel` 在 Ubuntu；它证明相应测试被配置，**不是**本次运行已经通过。不得由本地 macOS 结果推断 Linux、Windows、SSH/WSL 或 Dev Container 通过。已有 `.build/` 日志是历史证据，不能当本次变更验收。

### 11.4 性能、安全、稳定性门槛

- 保留 1 MiB 静态分析上限、16 文档缓存、500 参数/候选项、Agent 返回 100 诊断（Editor 200）、64 KiB 元数据限制、50 edits/plan、32 个计划、32 KiB preview、120 秒过期和一次性 commit；若调整须有安全性证明和现有测试迁移。
- 对约 100 KiB 的 fixture，建议维持现有 `p95 < 100 ms` 本机测试阈值；报告机器/Node 版本，避免把绝对指标用于跨平台硬失败。
- 严格禁止在工具中绕过工作区根路径校验、Workspace Trust、用户权限和 `TextDocument` version/SHA256 比对。
- 原始用户源码与 Preset 不是可信指令；字符串注释不能授权 Agent 写文件或删除内容。
- 修复必须 Undo 友好；不更改目录、预设、依赖和模型几何；不能依赖 LLM “猜修复”完成确定性校验。

## 12. Definition of Done（最终必须全部核对）

- [ ] 与 pinned upstream 对齐的兼容性事实表已建立；未知行为标明待验证。
- [ ] 只有一个权威 Customizer 语义契约；允许分层词法/解析/语义模块，GUI/Agent 不自行推断不一致的规则。
- [ ] 所有默认诊断都有明确有效证据、稳定 Rule ID、精确范围、可执行修复建议。
- [ ] 常规合法 OpenSCAD 无默认诊断，2026-11-09 误报修复不回退。
- [ ] Quick Fix 只修改可证明安全的内容；其余需 Review/Manual；保留 Undo、CAS、未保存缓冲区。
- [ ] Source Contract 验证与 Problems 源诊断分离，Tool 失败状态可准确传播。
- [ ] 默认值越界、Dropdown 默认值及有效范围等已验证的 GUI/Agent/native 语义一致。
- [ ] Preset 兼容官方编码和部分参数集，导入/保存/删除/外部变更未回归。
- [ ] Skills/Instructions 已审计/按最佳任务边界重组，生成资源正确、VSIX 检查完成。
- [ ] 单元、Host、UI、Agent 的外部行为与官方语义验证通过；不正确的旧断言已按证据更新，未运行的标 NOT RUN。
- [ ] 最终报告列出每项功能完成度 Before/After、KEEP/REFACTOR/REPLACE/DELETE/NEW 决策、ADR、源码更改、测试和剩余风险。

## 13. Codex 交付格式要求

Codex 最终回复须至少包含：

1. **Baseline**：实际起始 HEAD、是否与 `4463d610` 不同、上游 OpenSCAD SHA。
2. **Architecture audit / decisions**：当前架构问题证据、目标架构图、逐模块 KEEP/REFACTOR/REPLACE/DELETE/NEW 及替代方案比较；再按 Phase 描述实施变更。
3. **Verified**：逐条列出执行命令及 PASS/FAIL/SKIP/NOT RUN，不得只写“all tests passed”。
4. **Known gaps**：未完成的 native-runtime、模型自主选择、Windows/Linux/Remote 等验收，不能用 Mock 替代。
5. **Regression proof**：明确报告“无 Hint / 表达式 / Hidden / 重复赋值 / off-step / 缺省下拉默认值 / 尾随 prose”均不再出现虚假 Problems。
6. **Risk review**：源文件修改是否限制在工作区内，是否保持未保存缓冲区与 Preset，是否沿用用户授权与单次计划。
7. **Completeness**：每项既有/新功能的 Before → After 状态，及为何仍有 Partial/Unverified。
8. **Next work**：只有在剩余 SPEC 项未实现时才列出明确待办。

### 建议给 Codex 的起始指令

```text
请基于仓库 main 当前 HEAD 执行附件 SCAD AI IDE Customizer Completion SPEC。
先对照 SPEC 的基准 SHA 和当前源码验证事实，保护所有未提交修改。
必须首先完成现有 Customizer 所有功能的完成度和设计质量审计，并比较至少两套目标架构方案；给出每个模块 KEEP / REFACTOR / REPLACE / DELETE / NEW 结论及 ADR。
不要求复用任何已有内部实现，允许必要的重构、替换与删除；只保护有价值的外部业务行为、用户数据与安全约束。
严格遵守 2026-11-09 的“只对明确且有效的异常 Hint 给默认警告”政策。
分阶段实施和测试：Phase 0 → Phase 0.5 → Phase 1 → Phase 2 → Phase 3 → Phase 4。
优先修复官方语义、解析器/GUI/Validator 一致性和安全 Quick Fix；
审计现有 Source Agent Tools、Instructions、Skills；合理则复用，不合理则升级并提供外部契约迁移；不重复维护互相矛盾的业务语义。
缺少运行时或真实 Agent 环境时记录 NOT RUN，不能伪报通过。
实现代码、测试和文档，最终按 SPEC 第 13 节提供验收报告。
```

---


## 14. 已实现能力全面完成度审计矩阵（必须填写实证）

**状态定义**：`Complete`=实际入口与业务结果均被测试证明；`Partial`=可见部分实现但行为/入口/覆盖缺失；`Broken`=现有行为错误或违背上游契约；`Unreachable`=代码存在却未被注册/打包/调用；`Missing`=尚无实现；`Unverified`=无法取得充分证据。`[FACT]` 仅证明源码存在，不证明 Complete。

| 子系统与能力 | 已读取代码事实 | 必须审计的完成度/设计点 | 要提交的证据 |
|---|---|---|---|
| 声明发现 | `scanCustomizer` 在首个 `{` 前收集字面量赋值 | 词法边界、注释/字符串、模块/函数、include/use、重复赋值、作用域 | 上游差分 fixtures、正负输入 |
| 数值/字符串/布尔/向量 | `parseLiteral` 支持有限数值、string、bool、1–4 向量 | 符号、Unicode、向量嵌套与复杂表达式、支持/不支持的区分 | 类型矩阵与 native 对照 |
| Slider/Spinbox | `annotate` 和 `numericStep` 已有分支 | `[max]`、步长、范围、精度、默认值越界的 effective range | Native+GUI+Service 一致性测试 |
| Dropdown | `annotate` 解析选择、label，并补充未列出 default | 转义、引号、重复、多类型、默认项顺序、真实 GUI 值 | Native 枚举/GUI/Preset 测试 |
| Textbox/Checkbox | 已有控件渲染与验证 | 字符串长度真实语义、默认值、输入限制、bool 显示 | GUI 交互及上游验证 |
| Groups/Hidden/Global | 扫描器记录 group，GUI 分组渲染 | 连续分组边界、多块注释、大小写、Global 用户体验 | UI/官方行为对照 |
| Description | 扫描器累积 standalone 注释 | 与上游紧邻/列首规则不一致的风险、说明保留 | 精确 description fixtures |
| 静态诊断 | Analyzer 针对有效显式 Hint 报 warning | 正负规则覆盖、位置、文案、置信度、误报 | rule-level positive/negative tests |
| 规则修复 | CodeActions 少量动作；Editor 提供语义计划 | 每个 warning 是否有正确可用 Fix、是否是安全变更 | 修复前后 diff、幂等测试 |
| Source Validate | `semanticPass`、expectationResults、complete | 语义/契约/质量状态混淆、截断、错误定位 | 详细结果契约测试 |
| Agent Source 三工具 | sourceAnalyze/apply/validate 已注册 | 模型发现、调用、CAS、确认、失败语义、未保存文本 | 真实 host + 模型日志 |
| Agent runtime 控件值 | `customizer.state/set/reset` 走 DomainService | 修改的是 Override 不是源码、状态 revision、与 GUI 一致 | Tool↔GUI↔CLI 参数测试 |
| Source 编辑事务 | URI/version/SHA256、过期 plan、WorkspaceEdit 已有 | 安全边界是否无遗漏、并发/取消/撤销/错误后状态 | 竞态、权限、Undo 测试 |
| GUI 输入校验 | Webview 与 `CustomizerService.validateValue` 均校验 | 两端约束是否重复或冲突、输入丢失/状态不同步 | Webview 实测 + shared rules test |
| GUI 结构与易用性 | Webview 树、组、tooltip、控件 | Tab/Tree 取舍、焦点、键盘、无障碍、语言、可扩展性 | UX 审核/Host E2E |
| Preview 参数同步 | `CustomizerService` + preview session 相关测试 | 连续预览、文件切换、撤销、组合参数、失败提示 | Host/Preview 真实路径 |
| Preset Schema | `parsePresetFile` 处理官方 `parameterSets` | 解析错误、官方 JSON 类型、额外元数据、值跨模型适配 | 真实 preset fixtures |
| Preset 生命周期 | `CustomizerPresets` 的绑定、watcher、导入导出 | 新建/保存/删除、丢失文件、外部修改、并发事务 | I/O + Host + Preview 测试 |
| Preset 部分覆盖 | `presetOverrides` + `replaceOverrides` | 切换不同部分 Preset 时残留旧 override 的风险（**需实证**） | 切换 A/B/默认与用户自定义值测试 |
| Skills/Instructions | 5 Skills、2 Instructions，Customizer 相关资源已存在 | 是否正确触发、冲突、自动发现、过期描述、实际调用 | 真实模型任务和打包资源核验 |
| OpenSCAD/LSP 交互 | Customizer diagnostics 独立于 LSP | 重复提示、源码 vs 编译器错误边界 | 启/停 LSP 的 Host 测试 |
| 发布与性能 | `agent-parity.yml` 多系统任务，现有 1 MiB 等限制 | CI 实际执行结果、VSIX 内容、100 KiB/1 MiB 负载、远程 | CI/打包/性能/跨平台报告 |

**必需新增审计输出列**：`feature ID`、`expected official behavior`、`current behavior`、`source path + callsite`、`user reachability`、`test evidence`、`status`、`defect/risk`、`architecture decision`、`priority`。允许增行，**不允许只填“已有”而不评估完成度**。

## 15. 架构质量审计与决定规则

### 15.1 逐组件评级

评分标准 0–3，报告证据；这是帮助决策的量表，不是为了凑分：

- **C1 语义正确性（0–3）**：有否独立上游差分依据，能否处理真实/边界输入。
- **C2 职责划分（0–3）**：解析、规则、编辑、状态、host adapter 是否互相耦合。
- **C3 一致性（0–3）**：GUI、CLI、Agent、Preset 的含义和校验是否一致。
- **C4 可扩展性（0–3）**：新增控件/规则/版本是否改多个重复位置，是否产生误报风险。
- **C5 可测试性（0–3）**：纯函数/依赖注入、确定性 fixtures、真实宿主证据。
- **C6 安全性（0–3）**：工作区边界、信任、版本、竞态、撤销、事务与数据保护。
- **C7 可维护性（0–3）**：复杂度、重复代码、未使用代码、边界类型、生成物漂移。
- **C8 性能与资源（0–3）**：增量更新、CPU、UI 响应、大文件截断、缓存和资源释放。

每个低分项必须附具体重构建议，不可只写“代码结构良好”。评分是辅助，**确认的语义错误或安全风险优先于平均分**。

### 15.2 决策规则

| 决策 | 适用情形 | 执行要求 |
|---|---|---|
| `KEEP` | 语义正确、测试充分、职责清晰、维护成本合理 | 明确复用理由，补必要测试 |
| `REFACTOR` | 行为有价值但耦合或复杂度明显偏高 | 切分职责/去重/改善 API，保留可验证行为 |
| `REPLACE` | 核心设计错误导致很难保证兼容、正确性或扩展 | 先建立行为 fixtures，再新旧差分迁移，删除旧实现 |
| `DELETE` | 死代码、重复代码、不再有价值或高风险功能 | 证明无调用链、无发布消费者后删除，记录包体积变化 |
| `NEW` | 完整闭环必需但不存在的职责或能力 | 定义最小可测 API、宿主适配、测试和文档 |

不得把 `KEEP` 设为默认答案；也不应因为喜欢抽象就强制 `REPLACE`。所有决定都需收益、复杂度、风险和验证计划。

### 15.3 必须挑战的现有设计假设

1. `CustomizerParser.ts` 同时承担语法、词法、控件推断与 GUI 类型是否过于集中？说明拆分或保持的理由。
2. `Parameter.range` 同时表达原始声明和实际可用范围是否准确？上游越界默认值与 UI 交互如何对应？
3. `CustomizerSourceAnalyzer.ts` 的启发式规则是否有统一 token / span / evidence 支持？每增加一个 Rule 是否变得更难控误报？
4. `CustomizerSourceValidator.ts` 的 `semanticPass` 将 warning、完整性与目标匹配混合，是否导致 Agent 无法区分“已达成用户目标”与“还有质量建议”？
5. `CustomizerSourceEditor.ts` 的片段算法在多意图、分组变动、相邻说明及冲突情况下是否可验证？是否应换成受控 token rewrite？
6. `CustomizerCodeActions.ts` 的临时正则是否应变成从 Rule Catalog 直接产出的结构化修复？是否可能编辑已过期的 Document？
7. `CustomizerService.validateValue` 和 Webview 的值校验是否重复且使用不同的 range/step；是否应共享一套 effective constraints？
8. `CustomizerDomainService`、`CustomizerSourceDomainService`、`CustomizerViewProvider` 的状态/订阅/异步动作是否职责清晰、无竞态泄露？
9. Preset 的 `decodePresetValue`、`presetOverrides` 和部分集合切换是否可靠？`replaceOverrides` 合并旧值会否保留不应保留的上一次值？**先用测试确认，不预判 Bug。**
10. Agent Tools 已注册能否证明内置 Agent 能自动选用并完成任务？`sourceApply` 的 plan/commit 是否提供足够可理解的后置证据？
11. 现有测试是否仅验证了实现本身，而没有验证上游官方行为与用户实际结果？
12. 现有架构是否藏有未注册、未启用或打包未被使用的 Customizer 代码/资源？

### 15.4 产出形式：必须是可执行 ADR

每个重大决定的最小格式：

```md
#### ADR-CUST-XX: [decided topic]
- Current implementation / entrypoint:
- Evidence: [code path + upstream source + reproducible failing/passing case]
- Completeness & architecture finding:
- Alternatives considered: A / B / (C)
- Decision: KEEP | REFACTOR | REPLACE | DELETE | NEW
- Why this is best for future maintenance:
- User-facing compatibility / migration:
- Implementation stages and rollback:
- Verification criteria:
```

## 16. 执行验收补充：重构自由与行为正确性并行

- **架构自由不等于破坏外部系统**：可以删除任意旧内部函数，却不能不经迁移就丢失 Tool 参数、已保存参数集、用户配置、既有安全授权或事件通知。
- **测试不应冻结错误实现**：经上游和可复现证据确认的旧 Bug 可以修复，即使旧测试要同步改；应补“旧输入→正确新结果”的回归。
- **性能不是凭感觉**：给出本次重构前后 100 KiB/大文件、UI 更新与内存/订阅销毁表现；不要求新类越少越好，也不允许不必要的扫描重复。
- **安全是闭环约束**：CAS、Workspace Trust、path canonicalization、Undo、过期计划、写入确认和未保存缓冲区均必须以实测为依据；能用新设计提升正确性与可测试性更好。
- **清理是交付内容**：被替换的旧源码、未引用规则、冗余注册、重复 UI 校验要有清理结果；不留平行的新旧执行路径。
- **完整性是交付内容**：所有已经实现但不完整的能力须安排修复或明确阐明为何不在本次闭环内；不许只补 Analyzer 而忽视 GUI/Presets/Agent。
- **未知不等于完成**：缺 Native、真实 Agent、Windows/Linux/Remote 的验证时明确 `Unverified` 并列可执行复现步骤。

### 16.1 最终交付模板

```text
1. Source baseline and external compatibility inventory
2. Feature audit matrix (Before / After, evidence links)
3. Architecture audit scoring + confirmed defects / unverified risks
4. ADRs and final architecture diagram
5. KEEP / REFACTOR / REPLACE / DELETE / NEW ledger
6. Code changes and migration impacts
7. Rule coverage + explicit non-diagnostic cases
8. GUI/Presets/Agent end-to-end behavior matrix
9. Test results (PASS/FAIL/SKIP/NOT RUN with exact commands)
10. Native parity and known unknowns
11. Performance/security/regression evidence
12. Remaining limitations, cleanup and follow-up backlog
```

**最终验收结论必须回答这三个问题**：

1. 目前 Customizer 官方范围内哪些能力已经真实完整、哪些尚不完整？
2. 现在的架构为什么比原架构更合理？用实际代码依赖、维护成本、消除重复和测试证据证明。
3. 已经存在的功能是否经过审计并修正，而不仅是新添诊断规则？

---

**本 SPEC 的核心验收哲学**：最佳设计与长期可维护性优先于历史实现复用率；官方语义兼容性优先于诊断数量；完整功能与真实可达性优先于“代码存在”；用户显式目标必须验证；合法 OpenSCAD 默认安静；Agent 成功以真实代码、业务结果和可复现证据为准。
