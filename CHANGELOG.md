# Changelog

## 0.0.1

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
