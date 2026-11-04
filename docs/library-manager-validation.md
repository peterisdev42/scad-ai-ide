# Library Manager 本机验收记录

日期：2026-11-03。环境：macOS ARM64，Node.js v24.16.0，VS Code 1.144.1。使用 IDE 已管理的 OpenSCAD CLI 与 Preview Exporter，避免本机 PATH 中缺少 Boost 动态库的旧程序。

| 验证                                         | 结果                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 类型检查 / lint                              | 通过                                                                                                     |
| npm test                                     | 251 项通过（原有核心 129、依赖管理 23、Preview 99），0 跳过                                              |
| 依赖管理测试，启用 CLI / Exporter / 在线开关 | 23 项通过，0 跳过                                                                                        |
| Libraries VS Code 集成测试                   | 2 项通过：真实 Webview 与非法消息；真实 LSP 多项目版本隔离                                               |
| Libraries UI 测试，Microsoft Edge            | 1 项通过：三页导航、文本转义、精确版本选择、搜索、项目切换、清理限制、忙碌/信任状态                      |
| npm run package                              | 类型、lint、生产构建、原始第三方许可证暂存通过                                                           |
| 完整 VS Code 集成测试最后一轮                | 13/14；既有 native Enter 测试未通过，其他项目通过                                                        |
| 原始 HEAD 的 native Enter 对照               | 在独立临时副本 35ef101c60ca0fc03df8ff71c74db4b923b18400 中单独执行，复现同一失败；未改动该测试来绕过问题 |
| Windows / Linux                              | 已添加 CI 与真实 CLI/Junction 场景，本次没有在这些系统上执行                                             |

依赖用例覆盖 Registry 缓存与 ETag、来源异常隔离、多版本/仓库隔离、并发去重、独立 Node 进程互斥、过期锁恢复、取消/失败清理、安全 ZIP 与 CRC、损坏/孤立元数据、项目事务恢复、离线 Restore、复制确认及改动保护、引用重检和删除确认。

真实 OpenSCAD 用例验证了 include 经项目链接解析、版本切换产生不同几何、卸载保留全局 Store；在线 BOSL2 用例完成 Registry → Commit ZIP → Store → 项目链接 → STL → 离线 Restore。真实 Fast Preview 和 Markdown 验证使用同一项目依赖环境。源码摘要仅用于本地损坏检测，未宣称独立供应链认证。

[布局审核](library-layout-audit.md) 列出 29 项；22 项有明确的审核版本映射，7 项暂时禁止新安装并说明原因。除 BOSL2 的逐 Commit 根入口检查外，v1 未审核版本须等待明确的 v2 布局，不能将清单理解为所有版本均已完成真实渲染验收。

CI 尚未运行、既有 Enter 测试失败、未验证库及版本均属于本记录明确保留的发布验收限制。

## 2026-11-04 界面更新验证

Libraries 改为侧栏导航、项目上下文、搜索与库卡片布局，使用 VS Code 主题 CSS 变量。两项 Playwright 浏览器测试通过，覆盖既有操作协议、文本转义、忙碌/信任状态、搜索输入与版本选择保留、横向/纵向键盘导航和空结果跳转。

检查浅色、深色、高对比度深色、高对比度浅色四种主题的颜色变量与选中状态；Project / Global / Registry 在 320、480、720、960、1280px 窗口下均无横向溢出。类型检查、lint 与差异空白检查通过。本次仅调整界面，没有重跑后端下载与真实 CLI 测试。

同日按界面反馈将导航恢复为插件统一的顶部 Tab，顺序调整为 Registry / Global / Project，Tab 内部样式保留。再次通过两项浏览器测试，覆盖 Tab 顺序、左右方向键切换、四种主题和 320–1280px 窗口无横向溢出。

## 2026-11-04 Registry 列表缓存验证

Registry 列表改为 Runtime 同样的 globalState 持久化方式，并迁移旧 JSON 缓存。打开和重新进入页面时先发布本地列表，再刷新远端；本地搜索不等待请求，重复刷新合并请求。成功响应更新列表和缓存，空列表也可覆盖旧数据；失败或非法响应保留此前校验通过的数据。缓存按 Registry 来源隔离，保存失败不影响已下载列表使用。

依赖测试 26 项中 25 项通过，在线 BOSL2 用例默认跳过；其中缓存专项 7 项通过。三项 Libraries 扩展宿主测试通过，包括慢请求期间缓存可见、再次进入触发更新、非法消息处理和真实 LSP 项目隔离。类型检查、lint 和差异空白检查通过。

## 2026-11-04 精简布局、静默刷新与本地搜索

移除 Libraries 面包屑及 Libraries/Runtime 的 Tabbar 顶部标题；Libraries 使用 Runtime 同一居中容器。删除各页项目选择框，仅 Project 页保留只读 Current Project 路径，跟随当前源文件所属项目。

Registry 刷新与项目操作分离：已有缓存静默刷新、不阻塞操作；无内容时展示 Loading；失败保留缓存并展示错误，成功不展示通知。搜索在 Webview 对完整缓存目录做本地过滤，300ms 防抖，不发送搜索请求。

两项浏览器测试通过，使用虚拟时钟验证 299ms 不过滤、300ms 开始过滤及连续输入重置计时；同时验证只读项目路径、Runtime/Libraries 顶部标题隐藏、相同居中参数、四种主题、窄窗口和刷新错误状态。四项 Libraries 宿主集成测试通过，覆盖缓存可见、不占用项目 busy 状态、并发刷新合并、错误恢复和当前项目跟随活动文档。七项 Registry 单元测试通过；类型检查、lint 与差异空白检查通过。

## 2026-11-04 Registry 卡片精简与默认版本

删除各 Tab 的页面标题与说明、Registry 的数量/介绍栏和卡片 Versions / Latest / Sync / include 信息，将 Repository / Documentation 移至标题行右侧。初始化时状态及错误提示容器默认隐藏。版本默认采用 Registry 最新版本声明，否则采用已排序列表首项；保留用户选择和项目已锁定版本。下拉框使用 VS Code dropdown 主题变量、原生 select 交互和内缩 12px 的主题色箭头。

两项浏览器测试通过，覆盖首次无宿主数据时无空蓝/红提示条、精简内容、标题/链接对齐、显式 latest 与无 latest / snapshot 默认选择、版本保留、箭头间距、四种主题及 320–1280px 响应式布局。类型检查、lint、JavaScript 语法和差异空白检查通过。


## 2026-11-04 Global / Project 本地刷新与列表精简

Global 和 Project 每次切换进入时仅发布一次本地状态刷新，不展示 Refresh 按钮，不设置 Loading；再次打开已停留在本地 Tab 的页面也不请求 Registry。恢复上次选中的本地 Tab 时，初始化消息携带该 Tab，避免默认触发远端刷新。Registry 保留独立的静默远端刷新。

Global 按库和仓库合并缓存版本，通过下拉框选择；Verify、Repair、Preview Cleanup 跟随所选版本，并保留项目引用清理保护。删除 Commit、Size、Installed、ready 和存储引用详情。Project 删除 Ready、重复 ID、Commit 和 Mount，保留声明版本、异常状态和版本切换操作。

3 项浏览器测试通过，覆盖切换只发送一次刷新、渲染不循环触发刷新、恢复本地 Tab、版本选择保留、操作指向选中版本和清理保护，既有四主题及 320–1280px 响应式检查继续通过。4 项 VS Code 扩展宿主测试通过，新增断言确认进入及重新打开 Global / Project 不产生 Registry 请求。类型检查、lint、JavaScript 语法及差异空白检查通过。


## 2026-11-04 页面上下文保留、搜索栏与开发缓存工具

Registry 搜索图标改为输入框内部左侧，Refresh 与输入框右侧同一行居中对齐；间距使用 VS Code spacing token，并以主题字号计算回退值。Libraries / Runtime 恢复统一页面标题。Webview 设置 `retainContextWhenHidden`，Libraries 再次可见时只静默刷新当前 Tab，保留搜索、版本选择和当前页面，不重复创建 Webview。

More 新增仅 `ExtensionMode.Development` 可见的 Development Tab。宿主对每条读取/清除请求再次检查开发模式。展示所有 globalState / 当前 workspaceState 字段、磁盘目录缓存、Runtime / Registry 实时目录、Markdown / Preview 模型结果和部件元数据，支持逐项及全部清除。已安装资源继续由 Runtime / Libraries 管理，范围见 [开发模式缓存管理](development-caches.md)。

清除持久化目录字段时先等待请求写入结束，再删除字段、关联旧磁盘副本和内存目录。7 项 VS Code 宿主测试通过，包括 Webview 对象复用与隐藏保留、非开发模式拒绝、单项/全部清除、路径伪造和符号链接不跟随，以及清除后不会被挂起请求或旧文件恢复。

4 项页面测试通过，包括搜索图标边界与间距、Refresh 对齐、标题、开发 Tab 的显示条件、键盘导航、文本转义与清除消息、四主题及窄屏无横向溢出。11 项 Markdown、14 项 Preview、19 项 Customizer 回归测试通过；依赖单元测试 23 项通过，3 项 CLI/在线用例按环境默认跳过。类型检查、lint、JavaScript 语法和差异空白检查通过。截图保存在 `.build/library-manager-registry-dark.png`、`.build/more-development-caches.png`。


## 2026-11-04 Global / Project 统一卡片与批量清理

三个页面共用卡片渲染，Global / Project 补齐本地目录中可用的名称、描述、许可、缓存标记和标题右侧仓库/文档链接，操作区分别保留安装、版本切换、校验、修复和移除能力。目录缺失时保留来源链接与本地版本，并禁用需要目录信息的安装/切换按钮。项目路径改为无标签、无边框、无背景的普通弱化文字；Global / Project 顶部增加基础运行逻辑说明。

Global 增加 Verify All 与批量清理分体按钮，下拉支持保留每个库/仓库的一个最新已缓存版本。批量删除一次确认；确认后在 Store 锁内重新规划并检查引用，不删除预览后新增的缓存，仍跳过已知项目使用中或无法检查引用的内容。清理和最新版本选择仅使用本地目录，不发起远端请求。

依赖单元测试 30 项中 27 项通过，3 项 CLI/在线用例按环境默认跳过。新增覆盖推荐版本、数字版本与正式版排序、Snapshot 回退、按仓库分别保留最新、取消、确认后新引用和新缓存、不可访问项目保护。8 项扩展宿主测试通过，覆盖批量模式校验、本地校验报告、引用保护与当前项目源仓库字段。4 项页面测试通过，覆盖统一卡片信息、弱化项目路径、批量操作消息、分体菜单键盘/窄窗口、目录缺失时安全回退、四主题和 320–1280px 无横向溢出。类型检查、lint、JavaScript 语法和差异空白检查通过。Global / Project 深色截图保存在 `.build/library-manager-global-dark.png`、`.build/library-manager-project-dark.png`。
