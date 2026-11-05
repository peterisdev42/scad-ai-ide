# 开发模式缓存管理

以扩展开发模式启动 SCAD AI IDE 后，打开 **More → Development**。普通安装和扩展测试模式不显示该 Tab；宿主同样检查 `ExtensionMode.Development`，拒绝非开发模式的读取与清除消息。

缓存字段按 Field / Scope / Value / Action 四列表格展示，表格颜色、边框、悬停、按钮和焦点使用 VS Code CSS 变量；窄窗口在表格区域内横向滚动。展开 **Cached value** 查看内容；**Clear** 清除单个字段，**Clear All Caches** 清除当前全部字段，**Refresh** 重新读取当前值。清除期间禁用操作按钮，失败显示错误并重新读取当前列表。

**Open Global Folder** 使用系统文件浏览器显示当前扩展宿主的全局存储目录；不存在时先创建该目录。路径由宿主的 `globalStorageUri` 确定，不接受 Webview 提供的路径，仍仅限开发模式使用。

当前包含：

- 扩展的全部 `globalState` 和当前工作区 `workspaceState` 字段，包括 Runtime/Registry 列表、预览场景状态。
- 扩展存储下 `cache/` 与 `libraries/v1/cache/` 的磁盘列表缓存，包括旧版迁移缓存。
- Runtime 与 Library Registry 的实时内存目录、Markdown 模型结果、Preview 渲染结果和部件元数据。内存模型展示标识、状态、大小和依赖等信息，不复制大块模型二进制。

清除持久化目录字段时会等待正在进行的目录请求写入完成，再清除该字段、对应旧磁盘副本和内存副本，避免清除后被旧数据恢复。全部清除会尝试每个字段，汇总失败项；空内存缓存的检查入口仍然保留，之后的新请求可以重新填充缓存。

已安装 Runtime、Preview Exporter、Library 源码以及项目引用索引属于受管理资源，仍通过 Runtime / Libraries 页面管理，不作为此处的可丢弃缓存。GitHub 凭据由 VS Code Authentication 管理，不读取为缓存。

新增长期保留的内存缓存时，向 `memoryCaches` 注册只读快照和清除函数，并在缓存 owner 释放时注销。持久化 Memento 字段自动枚举，新增可丢弃磁盘缓存目录时需更新宿主目录清单。


## 2026-11-04 DEV Scope 分组、分类清除与值弹窗

移除 DEV 页介绍与汇总数量，打开全局目录按钮置于顶栏按钮组最右侧。缓存按实际 Scope 分组为独立表格，每组提供 Clear Scope。Cached value 改为按钮，打开原生 dialog 展示转义后的 JSON，支持 Close / Esc 及 Open in Editor。宿主按字段 ID 读取内容，在独立的非预览 JSON 未命名标签页打开，不将 Webview 内容直接作为缓存写入。分类清除校验允许的 Scope，沿用目录缓存关联失效逻辑。

6 项 UI 测试通过，覆盖多个分类表、顶栏顺序、介绍隐藏、分类清除消息、弹窗内容/关闭/Esc/编辑器消息及文本转义；窄屏无页面横向溢出。9 项宿主测试通过，覆盖生产/测试模式拒绝新增操作、非法 Scope 和字段拒绝、分类清除保留其他 Scope 字段，以及真实 JSON 未命名编辑器内容。类型检查、lint、JavaScript 语法和差异空白检查通过。


## 2026-11-04 复用 JSON TextMate 高亮与弹窗标题居中

删除弹窗中的正则 JSON 分词。开发宿主从已安装的 vscode.json 扩展语法贡献读取 source.json，复用 vscode-textmate / Oniguruma 和已有主题解析逻辑，返回纯文本 token、经过校验的主题颜色及字体标记。Webview 使用 textContent 与样式属性渲染，拒绝关闭弹窗或较新请求之后到达的旧高亮结果；主题和用户 token 配色变化后重新请求。标题栏网格使用 align-items: center，长标题仍在按钮左侧换行。

6 项 UI 测试与 10 项真实扩展宿主测试通过。宿主直接调用内置 JSON 语法和真实主题，检查转义文本、多行内容及有色 token；UI 检查 token 安全呈现、单行与多行垂直居中、320/720/1120px 下按钮右对齐以及编辑器打开行为。类型检查、lint、JavaScript 语法及差异空白检查通过。


## 2026-11-04 缓存弹窗尺寸与 Monaco 自动隐藏滚动条

弹窗调整为最大 1040px、高度 78vh（上限 840px）。通过单独打包的面板适配入口复用 Customizer 的 DomScrollableElement，加载其原生样式并覆盖 VS Code 主题变量；保持 JSON 自动换行、内容尺寸扫描、自动隐藏、滚轮与键盘滚动、减少动态效果及 workbench.list 设置。关闭并重新打开值弹窗时回到顶部，高亮异步更新后重新测量。

6 项 UI 测试通过，新增真实 Monaco 组件的滚动溢出检测、滚轮改变位置、移开鼠标自动隐藏和 Home 返回顶部验证；10 项宿主测试、类型检查、lint、构建、JavaScript 语法及差异空白检查通过。
