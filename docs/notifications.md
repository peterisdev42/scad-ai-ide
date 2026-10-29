# 统一通知系统

业务模块通过 `src/platform/notifications.ts` 导出的 `notifications` 上报问题。禁止在业务代码直接调用 VS Code 的 `showErrorMessage`、`showWarningMessage`、`showInformationMessage`；ESLint 会检查这一约束。输入框、进度提示和面板内状态继续使用各自的交互机制。

## 结构

- `src/core/notifications/NotificationCenter.ts`：不依赖 VS Code，负责并发聚合、问题生命周期、冷却时间和动作执行。
- `src/core/notifications/createNotifications.ts`：通知目录，集中定义问题标识、文案、级别、作用域、策略和恢复按钮。
- `src/platform/notifications.ts`：扩展宿主内唯一共享实例，将通知映射到 VS Code UI；处理通知展示或动作执行异常，避免未处理的 Promise rejection。
- `src/extension.ts`：激活时重置通知中心，释放订阅时销毁中心。去重状态不写入配置或磁盘。

## 聚合规则

| 问题                                   | 标识及作用域                         | 生命周期                                         |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| Runtime 缺失                           | `runtime.unavailable`，整个扩展共享  | 恢复前只提示一次，关闭通知或点击安装不会清除问题 |
| LSP 启动失败                           | `language.unavailable`，整个扩展共享 | 成功启动并完成配置后清除；反复启动失败不重复提示 |
| 编译、预览、导出、切片器、参数编辑错误 | 各类标识 + 文件 URI + 错误内容       | 同一通知尚未处理时合并；处理结束后冷却 10 秒     |
| 导出成功                               | `preview.exported` + 导出路径        | 同一目标的重复成功提示采用相同冷却策略           |

Runtime 的启动检测、渲染、导出和切片器路径都上报 `runtime.unavailable`，展示相同安装引导，不按来源或文件分裂。Runtime 检测确认存在活动项时调用 `runtimeAvailable()` 清除问题，下次缺失可再次提示；检测异常不冒充缺失。LSP 成功启动时调用 `languageAvailable()`。

普通问题默认使用完整通知文案去重；编译错误只展示首行，但使用完整错误作为 fingerprint，避免把不同编译错误误合并。不同文件或不同错误不会相互抑制。被抑制的通知不会重复执行按钮动作。预览原有的完整错误日志继续写入，不受通知聚合影响。

原生通知 API 不提供主动关闭已显示通知的句柄。问题恢复会清除聚合记录并使旧通知的按钮动作失效；已经显示的旧通知由 VS Code 管理。

删除参数集的确认框通过平台入口 `confirmDeleteParameterSet()` 展示，每次都等待用户决定，不参与去重。

## 新增通知

先在通知目录新增方法，选择稳定的问题标识、作用域和策略，再由业务模块调用该方法。同一根因的多个入口必须复用目录方法，不能用不同前缀拼接出多条通知。持续问题必须有明确的恢复入口，普通操作错误使用默认冷却策略。

`npm test` 覆盖并发聚合、持续问题关闭后的抑制、恢复重报、文件与错误隔离、动作只执行一次、展示与动作失败、旧动作失效、销毁与重置，以及 Runtime 检测和预览共用问题的回归。`npm run compile` 检查类型、通知入口约束并生成扩展和 Webview bundle。
