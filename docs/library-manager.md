# 第三方依赖库管理

从侧栏 Quick Access 打开 **Libraries**。依赖操作跟随当前源文件所属项目，可在 **Project** 页确认以弱化文字展示的只读项目路径。从 **Registry** 搜索库、选择精确 Tag 或 Snapshot Commit，点击 **Install to Project**。版本下拉框默认使用 Registry 声明的最新版本；未声明时使用 Registry 已排序列表的第一项，Snapshot 同样自动选中。用户手动选择后，状态刷新会保留该选择。

## 三个页面

- **Project**：展示声明版本与异常状态；可卸载、切换版本、Restore Dependencies、Repair Links。
- **Global**：按库合并展示共享源码缓存，通过下拉框选择已缓存版本；Verify 核对文件摘要，Repair 重新获取损坏源码，Preview Cleanup 显示删除确认。
- **Registry**：展示名称、描述、许可、源码/文档地址、版本及缓存状态。未知布局、版本未经审核、来源身份不一致、同步失败的库禁止新安装，并说明原因。

Libraries 隐藏后保留 Webview 上下文，切换到 Runtime 等页面再返回时不会重新初始化，当前 Tab、搜索输入和版本选择会保留。重新可见时静默刷新当前页，仅完全没有目录缓存时才显示 Loading。

首次安装需要访问 Registry 和上游仓库。Registry 列表沿用 Runtime 的本地缓存方式：成功校验的数据保存在 VS Code `globalState`。打开或切换进入 Registry 时先显示缓存列表，再静默刷新远端；已有缓存时不展示 Loading 或成功提示，也不阻塞安装等操作。首次没有缓存内容时展示 Loading，失败时保留已有列表并仅显示错误信息，成功后同步更新界面和缓存。搜索图标位于输入框内部左侧，Refresh 位于搜索框右侧并保持同一行居中对齐，间距跟随 VS Code spacing/font 变量。搜索在 Webview 内对本地列表按名称、ID、描述过滤，输入停止 300ms 后更新，无需搜索按钮，也不发送远端搜索请求。缓存刷新支持 ETag/304。已有 `libraries/v1/cache/registry.json` 会在缺少可用 `globalState` 缓存时校验并迁移；损坏或来源不匹配的缓存不会使用。离线时 **Restore Dependencies** 使用已有全局源码，无需重新解析 Registry，也不会跟随移动后的 Tag。源码缓存缺失时，从锁文件中记录的仓库和 Commit 下载，仍无需 Registry 可用。

当前 v1 Registry 的安装布局审核见 [29 项布局清单](library-layout-audit.md)。BOSL2 的每个选定 Commit 都检查根目录 `std.scad`；其余映射只开放清单里明确审核的 Commit。支持 Registry v2 的库级 `layout` 与版本级 `layout` 覆盖。布局确认不等于全部库、全部版本都已经完成真实渲染验收。

## 界面布局与主题

管理界面沿用插件其他页面的顶部 Tab 模式，顺序为 Registry / Global / Project，首次打开默认选择 Registry，并记住之后的选择。Libraries 与 Runtime 在 Tabbar 上方显示与其他页面一致的标题，Libraries 不显示面包屑，使用相同的居中容器、最大宽度和左右留白。各 Tab 不显示重复页面标题，Global / Project 使用普通文字介绍作用与运行逻辑，Registry 不显示列表统计标题；Registry 保留刷新操作、搜索和库卡片布局；Global 与 Project 每次切换进入时静默刷新本地数据，不显示刷新按钮。仅 Project 页以弱化的无边框文字展示当前项目路径，不显示路径标签，也不提供项目选择框。窄窗口下库信息与操作纵向排列。

颜色使用 VS Code 的 input、dropdown、button、focusBorder 和 contrastBorder 等 CSS 变量，跟随浅色、深色与高对比度主题。状态与错误提示默认隐藏，仅有实际内容时显示。Registry 卡片将 Repository / Documentation 放在标题行右侧，不展示 Versions / Latest / Sync 和 include 示例；版本下拉框保留原生键盘与菜单行为，箭头使用主题前景色并距右侧 12px。Global / Project 与 Registry 共用库卡片布局，展示目录中可用的名称、描述、许可、缓存标记及标题右侧仓库/文档链接；目录缺失时保留已有库标识和来源，版本切换暂不可用。Global 不展示 Commit、大小、安装时间、正常状态及存储引用详情，安装、校验、修复与清理操作跟随下拉框选中的缓存版本；Project 不展示重复 ID、Commit、挂载方式和 Ready 状态。异常状态仍然显示，已知项目使用中或无法确认引用的缓存版本仍禁止清理。状态刷新保留正在输入的搜索内容、焦点和已选版本。

Global 提供 **Verify All** 和 **Delete All Cached Versions** 分体按钮。主按钮批量清理可安全删除的版本，下拉菜单可选择 **Keep latest version of each library**。批量删除只确认一次，显示候选数量与大小，并跳过已知项目引用或无法检查引用的版本；确认后会重新检查引用和最新版本，不删除预览后新加入的版本。

“保留最新”按库 ID 和仓库分别保留一个已缓存 Commit：优先保留已缓存的 Registry 推荐版本，否则比较数字 Tag（同号优先正式版），没有数字 Tag 时使用本地目录顺序，再回退到安装时间。全过程不请求远端，不会为了清理而下载尚未缓存的新版本。完成后以普通文字报告删除、保留与保护跳过的数量。

## 项目文件与 Git

```text
.scad/
  dependencies.json       # 精确声明，提交 Git
  dependencies.lock.json  # 仓库、Commit、挂载布局，提交 Git
  lib/                    # 本机目录链接或确认后的复制，不提交
  mounts.json             # 本机挂载归属信息，不提交
```

管理器会将机器专属文件和事务目录加入项目 `.gitignore`；如果该文件本身是链接，会保留它，请手动补充忽略规则。锁文件不包含 Store 绝对路径。另一台机器克隆项目后，打开 Libraries → Project → Restore Dependencies，即可按原 Commit 重建挂载。

以 BOSL2 为例，安装后使用：

```scad
include <BOSL2/std.scad>;
cuboid([10, 12, 14], rounding=1);
```

单文件库也有明确命名空间，例如 `use <threads-scad/threads.scad>;`；dotSCAD 使用 `dotSCAD` 名称挂载仓库 `src` 目录。具体名称以 Registry 页面与锁文件为准。

Manifest 与 Lockfile 必须一致。管理器不会悄悄重解析手工改动后的声明或移动后的 Tag；遇到 **Lockfile Mismatch**，请通过精确版本安装/切换操作修正该依赖，或恢复配套的声明与锁文件后再 Restore。没有版本范围求解和递归依赖自动安装；复杂库的前置条件需单独确认。

## 存储与跨平台运行

源码放在扩展宿主的 `globalStorageUri/libraries/v1/store/<id>/<repository-hash>/<full-commit>/source`。仓库身份参与目录键，同一个 Commit 的多个 Tag 共享源码，不同 Commit 可共存。Global 的索引从实体元数据重建；损坏、缺少元数据的孤立实体会显示诊断，不会被误当作可复用缓存。

macOS/Linux 使用目录 Symbolic Link；Windows 优先 NTFS Junction。只有链接权限或文件系统不支持时才提示复制，显示额外磁盘占用并要求确认。修改过的复制文件和未知普通目录不会被覆盖或移除，需要先移走本地改动。

远程 SSH、WSL、Container 使用扩展宿主所在系统的 Store 与路径。Full Render、Fast Preview、Markdown 和 LSP 都从同一个 LibraryEnvironment 获取项目搜索路径；每个子进程单独设置 `OPENSCADPATH`，保留继承的路径，不修改系统或全局 `process.env`。不能用路径列表分隔符表达的目录（POSIX 中的 `:`、Windows 中的 `;`）会明确报错。

LSP 为不同项目建立独立会话和文档选择器，避免同名库的不同版本互相污染。依赖变化会刷新普通预览、Markdown 缓存与语言服务；预览缓存还包含依赖指纹。

## 修复、安全与清理

- 安装先在 staging 下载、解压、检查布局、计算文件清单，再原子发布；支持取消和进程间互斥。ZIP 拒绝路径穿越、特殊文件/链接、Windows 保留名、大小写与 Unicode 冲突、超限解压。
- 项目变更保留事务快照。失败时恢复旧挂载与旧声明；进程中断后，下次 Restore/安装/卸载会先恢复事务。完成事务先原子移出恢复入口再清理，避免清理中断被误判成未提交事务。
- 本地 SHA-256 清单只能识别安装后的损坏；Registry v1 没有可信预期摘要，不能据此声称独立验证了供应链真实性。
- 从 Project 卸载只解除项目引用。全局实体仍保留，可被其他项目使用或离线恢复。
- 清理只由用户主动触发：扫描实体与已知项目 → 预览确认 → 在 Store 锁内重新检查引用 → 删除。已知项目仍引用或无法读取时拒绝删除。零个已知引用也不代表没有外部项目，确认对话框会明确提醒。
- 全局损坏源码重装时，旧实体会保存在 staging 的隔离目录中。恢复项目锁文件可修复元数据缺失的实体；没有来源身份的孤立目录不允许从 Webview 提交任意路径删除。
- Workspace Trust 未授权时不允许安装、卸载、修复、清理或执行 OpenSCAD。下载与路径均运行在扩展宿主，不将本机路径写入远程项目。

## 开发验证

```sh
npm run check-types
npm run lint
npm run test:libraries
npm run test:libraries:ui
npm run test:libraries:integration
npm run test:integration
```

单元/文件系统测试已纳入 `npm test`。`SCAD_OPENSCAD_EXECUTABLE` 指定真实 CLI；`SCAD_REQUIRE_CLI=1` 使缺少 CLI 成为失败。设置 `SCAD_PREVIEW_EXPORTER` 后，还会验证真实 Fast Preview 和 Markdown 的项目库解析。UI 测试使用 Playwright Chromium，可用 `SCAD_BROWSER_CHANNEL=msedge` 选择已安装浏览器。

`npm run test:libraries:online` 执行在线 BOSL2 完整链路；默认测试不依赖 Registry/GitHub 实时可用性。VS Code Integration Test 需要可运行的本平台 LSP；已有 Markdown 集成还要求 `SCAD_PREVIEW_EXPORTER`。

[CI](../.github/workflows/libraries.yml) 在 macOS/Linux/Windows 运行类型、lint、依赖测试和真实 CLI smoke；Windows 分支实际创建、解析和删除 Junction。CI 配置已加入，但本机验收不代表三平台 CI 已经通过。Fast Preview 仍限现有实现支持的 macOS ARM64。

## Registry v2 布局草案

保持 v1 响应不变；v2 使用 `schemaVersion: 2`，增加可选的库级布局，版本级布局优先。字段必须是安全的单目录名与仓库相对目录，并在下载的实际 Commit 中再次校验。

```json
{
    "layout": { "includeName": "dotSCAD", "includeRoot": "src" },
    "versions": [
        {
            "kind": "tag",
            "tag": "<exact tag>",
            "commit": "<full SHA>",
            "downloadUrl": "<repository>/archive/<full SHA>.zip",
            "layout": { "includeName": "dotSCAD", "includeRoot": "src" }
        }
    ]
}
```

此段仅展示新增字段，不是完整 Registry 示例；现有版本、同步、许可与来源字段仍然必需。Registry v1 某一库的仓库与下载身份不一致时，该项单独禁用，不阻断其他合法库。BOLTS 的已改名下载目标是当前发现的一例，需 Registry 上游修正后重新审核。

本次结果与已知限制见 [本机验收记录](library-manager-validation.md)。
