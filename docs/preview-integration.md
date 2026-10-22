# Preview 集成说明

选择源码迁移并适配宿主，而非重写视口。来源为相邻 `sources/vscode-openscad-preview` 当前工作树（HEAD `4bbb851853bbf1780a568b70e06824a365c7dbe2`），包括其视角立方体、导航和打印平台改动；没有修改来源仓库。其 Three.js/Lit 组件、rig、工具、shader、打印平台 STL 和消息协议迁入 `src/features/preview/`。这是独立可构建的源码快照，构建、发布和运行不读取相邻 Preview 仓库，也不安装该扩展。

## 宿主边界

- `registerPreview.ts` 在现有扩展入口注册 CustomTextEditorProvider；命令和 viewType 使用 `scad-ai-ide` 前缀，语言 ID 使用已有 `openscad`。沿用 VS Code 内置 Markdown 使用的 `reopenActiveEditorWith` 标签替换方式，升级 VS Code 时应重跑宿主测试。
- `ScadClient` 使用统一 Runtime 的 executable/argsPrefix，检查工作区信任，不自行探测 OpenSCAD。源码未保存时走 stdin，cwd 为源码目录，字符串通过 JSON 字面量编码后作为独立 `-D` 参数传递，不使用 shell。
- 每文件一个会话；新的预览取消旧预览，导出有独立任务标识，不取消预览。会话关闭取消等待中的/运行中的预览，释放 watcher 和事件；临时渲染目录在成功、失败、取消后回收。
- 文件监视使用 VS Code FileSystemWatcher，无需 chokidar。配置与 Runtime 变化刷新已打开的预览。3MF 和 lazy-union 能力由选择的 OpenSCAD 提供，默认 STL 不假定安装 nightly。
- `ScadParser` 是既有 `parseCustomizer` 的 UI schema 适配器；原生侧栏与预览共用 `CustomizerService` 每文件覆盖值，通过订阅同步。只给 CLI 传显式覆盖值，表达式继续由 OpenSCAD 计算。JSON 预设、场景与测量交互保留在迁入模块中。

## 构建与发布

扩展宿主与浏览器分别使用 `tsconfig.json` 和 `tsconfig.webview.json`。`esbuild.js` 输出 `dist/extension.js`、`dist/preview.js`，将 shader 和 STL 嵌入浏览器 bundle，并复制 codicon CSS/字体到 `dist/codicons/`。VSIX 不依赖运行时的 node_modules 或 src 目录。Webview 仅允许 dist 本地资源，脚本使用 nonce CSP，字体不请求外部 CDN。

原有语言高亮、snippets、LSP 不重复迁入。

## 验证

`npm test` 覆盖核心、语言与视口回归；`npm run package` 检查宿主/浏览器类型、ESLint 及生产 bundle。`test:preview-editor` 使用实际 VS Code API 和假 CLI 检查标签替换、dirty 文档保留、Open With、启动前缀、stdin/cwd、双向参数同步、JSON 预设与导出。真实几何、显卡渲染和本机切片软件仍需对应运行时与设备验收。

本次验收：42 项单元测试、生产构建、格式检查及预览宿主测试通过；本机 OpenSCAD 2026.10.10 的真实 STL/3MF 导出烟测通过；VSIX 文件清单包含预览 bundle、codicon CSS/字体。原有全量宿主测试的回车缩进用例在当前本地 Code OSS 中失败，同样的测试在未修改的 HEAD 基线中亦失败，其余 7 项通过。没有为本次集成修改原有语言配置或回车测试。

可设置 `SCAD_OPENSCAD_EXECUTABLE` 为支持 3MF 的真实 OpenSCAD 路径，随 `test:preview-editor` 额外执行 STL/3MF 导出烟测；默认测试仍使用假 CLI，无需安装 OpenSCAD。

## 手动双向同步

本插件根目录提供 `npm run preview:sync -- to-ide` 与 `to-preview`，分别生成外部到内部、内部到外部的审阅计划；加 `--apply` 可在无冲突时直接应用。同步使用两份独立基线和三方合并，保留宿主适配，不改变本扩展独立构建、独立运行的方式。同步脚本及 `.preview-sync/` 基线随本插件维护，不依赖 Builder；默认使用相邻 Preview 仓库，可通过 `PREVIEW_SYNC_PREVIEW_ROOT` 指定其他路径。完整流程及冲突解决见 [同步说明](../scripts/preview-sync/README.md)。同步不拉取上游、不自动执行、不提交 Git。初始基线已建立，不需要重新 init。
