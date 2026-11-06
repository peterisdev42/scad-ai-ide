# Changelog

## 0.0.1

- 修正带闭合括号及尾随说明的 Customizer 注释被误报为缺少 `]`；正确区分引号中的括号，并保护结构化编辑中的尾随说明。

- 收紧 Customizer 诊断：缺省注释、重复赋值、表达式、Hidden、未列出的下拉默认值与步长网格等正常用法不再产生基础使用提示；警告只针对实际写出的、可修复的注释问题。
- 显式控件目标不匹配改为 `expectationResults` 验证结果，不再伪装成源码错误；可选分组/注释操作归为 Refactor。

- 修正 Customizer 重复赋值的过度告警：只检查最终生效声明，忽略已被覆盖的旧范围/默认值；合法覆盖不再被判为错误。表达式导致控件不可见等情况只保留候选元数据，不主动生成基础使用提示。

- 固化 Runtime、Customizer、Libraries、More 四个管理面板的 GUI/Agent 业务能力对等要求，生成并校验逐动作 Agent 参数契约。
- 补齐 GUI 发起任务的 Agent 取消、在线 Runtime 强制刷新语义与已安装标记、安装/删除后置校验、库任务进度与安装能力元数据，以及 GitHub/开发缓存诊断信息。

- 增加 Customizer 源码分析、结构化 plan/commit 与目标验证工具，使用独立 URI/version/SHA-256 并发保护；保留未保存 buffer、Undo 与现有 Override/Preset 工作流。
- 共享 Parser 扫描器提供源码位置与有界诊断，接入 Problems 和安全 Quick Fix；可通过 `scad-ai-ide.customizer.sourceDiagnostics` 关闭。
- 增加 Customizer Authoring Instructions、Skill、语法参考与精选 snippets，并同步生成 40 个 Agent Tools 的清单。

- 集成 OpenSCAD Preview 的 Lit/Three.js 交互式视口、测量、剖切、场景保存、参数预设、STL/3MF 导出及切片软件发送。
- 统一预览的 Runtime 选择、Customizer 解析与覆盖值；增加预览资源打包、CSP、取消/临时文件清理和视口/扩展宿主回归。

- 按 JS/TS 标准 scope 重设计 TextMate 高亮，区分变量、形参、命名实参、函数/模块调用和控制流，兼容 Dark+/Light+ 等主题；增加多行签名、嵌套默认值与主题颜色回归测试及示例。

- 增强字符串/注释安全的括号缩进、无花括号单语句缩进与块注释回车续行。
- 通过 openscad-LSP 解析树提供结构折叠，保留 region 标记，并在编辑后更新范围。
- 静态片段启用时隐藏重复的 LSP 关键字模板，保留函数和用户符号补全。
- 原子替换暂存的 LSP 二进制，避免 macOS 开发时复用旧可执行文件 inode。

- 使用标准 VS Code Language Client 通过 stdio 接入 openscad-LSP，增加源码构建与平台打包、配置同步和生命周期管理。
- 增加 OpenSCAD TextMate 高亮、snippets、括号与注释配置、自动缩进、region 标记折叠及语言功能测试。

- 使用独立的 Customizer 和 Quick Access 原生 TreeView。
- 增加 AI、Bricks、Libraries 和 Runtime 编辑器管理页，统一管理页面复用、生命周期与消息通信。
- 增加简单 Customizer 参数解析、原生编辑、每文件覆盖值与 CLI `-D` 参数生成。
- 增加 OpenSCAD 多来源发现、版本验证、去重、选择持久化与纯文本状态栏。
- 分离 Core、Features 和 Platform，并补齐核心与扩展宿主测试。
- 配置 Prettier、EditorConfig 和 VS Code 保存格式化。
