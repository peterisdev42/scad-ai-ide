# Preview Problems 生命周期与源码导航

2026-11-11。修复用户报告的两个问题：切换 Text 会清空 Preview 编译诊断；默认关联 Preview 时，Problems 的资源打开无法显示文本行列。原始模型测试没有恢复，用户文件和编辑器偏好没有修改。

## 实现

`PreviewSourceProblems` 由扩展注册层持有，独立于 Webview 和渲染 Session。SCAD/CSG 的编译、求值、运行时错误进入该服务；Webview、GPU、二进制网格错误仍由单个视图持有。关闭或重建 Preview、Preview→Text 都保留源码诊断；编译成功清除源码结果，当前有效帧清除图形错误，关闭视图释放视图错误。

源码结果记录缓冲区 SHA256。源码或已关联 include 的缓冲区变化会使旧结果失效；已开始的请求若源码身份变化，不得再次发布旧错误。重新打开文本模型也会检查哈希。源码变化导致失效表示“旧结果不再能证明当前状态”，不表示修改已验证成功；需要新的实际编译结果才能确认恢复。开始相同源码的新请求时保留上次失败，直到成功或更新结果到达。

关闭的源码文件保留最后一次验证结果，类似工作区编译诊断；缓存最多保留 128 个源文件，以避免保留关闭文件造成无限增长。扩展停用或源文件通过 VS Code 删除/重命名时清理对应结果。相关文件诊断的 URI 和位置仍指向实际文件。该缓存不替代全工作区编译器，也不保证发现关闭文件依赖在外部被修改的所有情形；Remote 和外部文件系统变化的穷尽测试未执行。

导航提供两个入口：

- Preview 底部错误状态中的 `Open source at error` 按钮，使用 VS Code 官方主题 CSS 变量，支持键盘操作。
- Problems 诊断的 `Preview: open source at this error` Quick Fix；只提供导航，不生成 WorkspaceEdit、不删除或修改源码。

操作使用官方 `vscode.openWith(uri, 'default', {selection, preview:false})` 明确选择文本编辑器并定位。打开前重新确认错误仍属于当前结果、重新打开源码模型以检查内容；源码已变化或错误已替换时，旧操作返回 false，避免跳向过期位置。Webview 不能指定任意文件，只能请求当前 Preview 的实际诊断导航。

## 普通 Problems 单击的边界

**本次没有声称改写了普通错误行的单击行为。** VS Code 官方 [Problems 实现](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/markers/browser/markersView.ts)将资源和 selection 交给 EditorService；稳定 Diagnostic/CustomTextEditorProvider API 不提供为单条诊断指定默认编辑器或拦截此点击的回调。[官方 openWith 命令](https://code.visualstudio.com/api/references/commands)支持在我们的显式导航操作里指定 default 编辑器。

保留 `*.scad → scad-ai-ide.preview.editor` 时，普通资源打开仍可能停留 Preview。两个真实宿主的 Problems 风格资源打开测试均观察到此行为；新增源码操作则切至 Text 并定位成功，且断言全局关联未改变。该测试使用 `vscode.open` 的资源/selection 路径与官方实现核对，**没有自动鼠标点击原生 Problems 行**。未覆写内置命令、使用内部 API、篡改全局关联，也未把 Diagnostic.code.target 当成普通行点击处理器。

## 已执行验收

| 范围 | 结果 |
|---|---|
| 构建、catalog、类型、lint | PASS |
| core | 219 PASS |
| Preview Node | 103 PASS |
| Library | 26 PASS / 3 条件 SKIP |
| Chromium Preview | 19 PASS，包括按钮键盘 Enter→导航消息、按钮按来源隐藏、既有渲染与恢复 |
| VS Code 1.140＋真实 OpenSCAD | 4 PASS：API 诊断、实际 Session 编译失败→恢复、实际生产 custom editor Preview→Text 保留→Quick Fix 强制 Text/定位→未保存修复失效→原生成功、包含文件与陈旧结果/缓存上限/二进制视图清理 |
| VS Code 1.145.2＋真实 OpenSCAD | 2 PASS：生产 Preview/Text 导航与诊断生命周期、缓冲区及陈旧结果失效 |

初次 Host 为 3 PASS/1 FAIL：测试读取了更新前的 WorkspaceConfiguration 快照，误判编辑器关联被清空。改为重新读取当前配置后，两个宿主均通过关联未改变的断言。初次编译还记录了构造函数注入尚未同步到测试夹具的类型错误；均保留原始日志，没有记为通过。

NOT RUN：原生 Problems 普通行鼠标点击的 UI 自动化；完整 Host 全套；跨平台/Remote；关闭文件的所有外部修改情形；真实模型读取；新 VSIX 打包与安装。原有失败和未执行项目没有因本项变更转为通过。F5 调试宿主需重启以加载新的扩展代码。

[验证证据与哈希](evidence/lifecycle-navigation-2026-11-11/manifest.json)。
