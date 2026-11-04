# 开发模式缓存管理

以扩展开发模式启动 SCAD AI IDE 后，打开 **More → Development**。普通安装和扩展测试模式不显示该 Tab；宿主同样检查 `ExtensionMode.Development`，拒绝非开发模式的读取与清除消息。

缓存字段按名称和来源展示，展开 **Cached value** 查看内容；**Clear** 清除单个字段，**Clear All Caches** 清除当前全部字段，**Refresh** 重新读取当前值。清除期间禁用操作按钮，失败显示错误并重新读取当前列表。

当前包含：

- 扩展的全部 `globalState` 和当前工作区 `workspaceState` 字段，包括 Runtime/Registry 列表、预览场景状态。
- 扩展存储下 `cache/` 与 `libraries/v1/cache/` 的磁盘列表缓存，包括旧版迁移缓存。
- Runtime 与 Library Registry 的实时内存目录、Markdown 模型结果、Preview 渲染结果和部件元数据。内存模型展示标识、状态、大小和依赖等信息，不复制大块模型二进制。

清除持久化目录字段时会等待正在进行的目录请求写入完成，再清除该字段、对应旧磁盘副本和内存副本，避免清除后被旧数据恢复。全部清除会尝试每个字段，汇总失败项；空内存缓存的检查入口仍然保留，之后的新请求可以重新填充缓存。

已安装 Runtime、Preview Exporter、Library 源码以及项目引用索引属于受管理资源，仍通过 Runtime / Libraries 页面管理，不作为此处的可丢弃缓存。GitHub 凭据由 VS Code Authentication 管理，不读取为缓存。

新增长期保留的内存缓存时，向 `memoryCaches` 注册只读快照和清除函数，并在缓存 owner 释放时注销。持久化 Memento 字段自动枚举，新增可丢弃磁盘缓存目录时需更新宿主目录清单。
