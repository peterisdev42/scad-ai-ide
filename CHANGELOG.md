# Changelog

## 0.0.1

- 使用标准 VS Code Language Client 通过 stdio 接入 openscad-LSP，增加源码构建与平台打包、配置同步和生命周期管理。
- 增加 OpenSCAD TextMate 高亮、snippets、括号与注释配置、自动缩进、region 标记折叠及语言功能测试。

- 使用独立的 Customizer 和 Quick Access 原生 TreeView。
- 增加 AI、Bricks、Libraries 和 Runtime 编辑器管理页，统一管理页面复用、生命周期与消息通信。
- 增加简单 Customizer 参数解析、原生编辑、每文件覆盖值与 CLI `-D` 参数生成。
- 增加 OpenSCAD 多来源发现、版本验证、去重、选择持久化与纯文本状态栏。
- 分离 Core、Features 和 Platform，并补齐核心与扩展宿主测试。
- 配置 Prettier、EditorConfig 和 VS Code 保存格式化。
