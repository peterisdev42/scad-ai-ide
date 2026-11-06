# 开发模式缓存管理

以扩展开发模式启动 SCAD AI IDE 后，打开 **More → Development**。普通安装和扩展测试模式不显示该 Tab；宿主同样检查 `ExtensionMode.Development`，拒绝非开发模式的读取与清除消息。

缓存按 `globalState`、`workspaceState`、`Memory`、`Disk` 分组，每组使用 Field / Value / Action 表格，提供 **Clear Scope**；**Clear** 清除单个字段，**Clear All Caches** 清除全部字段，**Refresh** 重新读取。表格、按钮和弹窗使用 VS Code CSS 变量，窄窗口只在表格区域横向滚动。

点击 **Cached value** 打开内容弹窗（最大 1200px、窗口高度 80%），JSON 使用 VS Code 内置 JSON 扩展提供的 TextMate 规则，通过 vscode-textmate / Oniguruma 分词并匹配当前主题及用户 tokenColorCustomizations，保留颜色和字体样式；主题切换时重新请求高亮。超过 1 MiB 时使用纯文本以避免大量高亮节点。标题自动换行并与右侧 Open in Editor / Close 垂直居中。内容区复用 Customizer 的 Monaco DomScrollableElement，滚动条自动隐藏，跟随 VS Code 主题与 workbench.list 的滚动设置，并支持键盘滚动。可通过 **Close** 或 Esc 关闭。**Open in Editor** 从宿主重新读取该字段，在新的非预览 JSON 编辑器标签中展示；标签为独立未命名文档，编辑内容不直接修改缓存。读取和分类清除均校验字段 ID / Scope，仍只在开发模式下允许。清除持久化目录字段时会连带失效对应内存副本，避免旧值恢复；其他不相关 Scope 字段保持不变。

**Open Global Folder** 位于按钮组最右侧，使用系统文件浏览器显示当前扩展宿主的全局存储目录；不存在时先创建该目录。路径由宿主的 `globalStorageUri` 确定，不接受 Webview 提供的路径。

当前包含：

- 扩展的全部 `globalState` 和当前工作区 `workspaceState` 字段，包括 Runtime/Registry 列表、预览场景状态。
- 扩展存储下 `cache/` 与 `libraries/v1/cache/` 的磁盘列表缓存，包括旧版迁移缓存。
- Runtime 与 Library Registry 的实时内存目录、Markdown 模型结果、Preview 渲染结果和部件元数据。内存模型展示标识、状态、大小和依赖等信息，不复制大块模型二进制。

清除持久化目录字段时会等待正在进行的目录请求写入完成，再清除该字段、对应旧磁盘副本和内存副本，避免清除后被旧数据恢复。全部清除会尝试每个字段，汇总失败项；空内存缓存的检查入口仍然保留，之后的新请求可以重新填充缓存。

已安装 Runtime、Preview Exporter、Library 源码以及项目引用索引属于受管理资源，仍通过 Runtime / Libraries 页面管理，不作为此处的可丢弃缓存。GitHub 凭据由 VS Code Authentication 管理，不读取为缓存。

新增长期保留的内存缓存时，向 `memoryCaches` 注册只读快照和清除函数，并在缓存 owner 释放时注销。持久化 Memento 字段自动枚举，新增可丢弃磁盘缓存目录时需更新宿主目录清单。

## Agent 访问边界

Agent 使用同一个缓存控制器，但只能列出有界元数据或读取一个脱敏预览，不能批量获取 GUI 原始值。内容预览可能仍包含未识别的个人信息。清理需要真实用户确认，重新验证选中字段，清理后向 GUI 发布状态；普通安装中即使直接调用工具也拒绝缓存读取与清理。具体验证入口见 [Agent 验证指南](agent-verification.md)。
