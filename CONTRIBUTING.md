# 开发说明

SCAD AI IDE 是 VS Code workspace 扩展。Node.js 代码运行在 Extension Host，Preview Webview 运行在浏览器环境；运行时、语言服务和原生导出器运行在扩展所在主机（包括 SSH、WSL 和容器）。

## 准备环境

使用 Node.js 24、npm，以及满足 `package.json` 中 `engines.vscode` 要求的 VS Code。构建语言服务还需要 Rust stable 和 Cargo。

```sh
npm ci
git submodule update --init --recursive
npm run prepare:lsp
npm run compile
```

F5 使用 `.vscode/tasks.json` 先准备 LSP，再启动 TypeScript 和 esbuild watch。`prepare:lsp` 可以复用当前平台已暂存的可运行程序；正式发布的 `vscode:prepublish` 始终从子模块源码构建 LSP。

## 目录职责

```text
src/
  extension.ts           激活入口与服务组合
  core/                  Runtime、Customizer、格式和 Preview 数据处理
  platform/              文件系统、进程、GitHub、安装和通知适配
  features/              VS Code 功能注册、面板、语言服务和 Markdown
    preview/
      extension/         Preview 的 Extension Host 会话、渲染和编辑器
      shared/            Host 与 Webview 的消息和数据类型
      webview/           Lit 界面、Three.js 场景和 Goldfeather 渲染
  test/                  Node 单元测试、VS Code 集成测试及夹具
    preview/             由 tsx 执行的 Preview 测试
    editor/              真实编辑器测试的宿主入口
media/                   面板、Customizer、Markdown 的静态界面资源
resources/               扩展和语言图标
syntaxes/                TextMate 语法与 Markdown 注入规则
snippets/                OpenSCAD 补全片段
scripts/                 构建、浏览器测试、性能测试和同步工具
  helpers/               浏览器测试共享夹具
  preview-sync/          手动双向同步实现、配置、测试和说明
sources/                 三个独立管理的 Git 子模块
.preview-sync/           受版本控制的同步基线和内容对象
examples/                手工验收与用户示例
docs/                   架构、验收和历史研究文档
  artifacts/             已记录的性能 JSON 和原始截图
  images/                文档演示图片
```

`dist/`、`out/`、`.build/`、`server/`、`licenses/` 和 `.vscode-test/` 都是本地生成目录，不提交版本控制。`dist/`、`server/`、`licenses/` 中的必要产物会随 VSIX 分发；不要因为 Git 忽略它们就从打包规则中排除。静态界面资源和语言贡献路径由 manifest、构建脚本及 Host 代码共同引用。

保持已有 `core / platform / features` 边界：核心处理不依赖 VS Code 界面，平台适配提供宿主能力，功能层负责注册与交互。Preview 子树还承担与上游独立扩展的同步职责，不应仅为了统一命名而搬动。两个 `CustomizerPresets.ts` 分别负责纯数据处理和 VS Code 文件 I/O，不是重复实现。

## 验证命令

| 命令                                                  | 覆盖范围与前置条件                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run check-types`                                 | Host 和 Webview 各自的 TypeScript 配置                                            |
| `npm run lint`                                        | `src/` 静态检查                                                                   |
| `npm test`                                            | 编译 Node 测试、运行核心测试及 Preview 单元测试；部分真实导出器测试缺少程序时跳过 |
| `npm run test:preview-sync`                           | 同步引擎测试，真实双仓库用例需要 Preview 工作副本                                 |
| `npm run test:customizer`                             | Customizer 浏览器测试                                                             |
| `npm run test:markdown`                               | Markdown 单元与浏览器测试                                                         |
| `npm run test:fast-preview`                           | 快速预览单元与浏览器测试                                                          |
| `npm run test:preview-gpu`                            | Goldfeather WebGPU / WebGL2 真实画布测试                                          |
| `npm run test:integration`                            | VS Code Extension Host 测试，可能下载测试版 VS Code                               |
| `npm run test:preview-editor`                         | 真实编辑器测试；需要 `SCAD_VSCODE_EXECUTABLE`                                     |
| `npm run test:markdown-host`                          | 真实 Markdown Webview；需要 `SCAD_VSCODE_EXECUTABLE`                              |
| `node --test scripts/preview-switch-webview.test.mjs` | 真实预览切换；需要 `SCAD_VSCODE_EXECUTABLE` 和 `SCAD_OPENSCAD_CSG_EXECUTABLE`     |
| `npm run package`                                     | 类型检查、lint、生产 bundle、第三方许可证暂存；不生成 VSIX，也不构建 LSP          |
| `npm run build:lsp`                                   | 构建并暂存当前宿主平台的 LSP                                                      |

浏览器测试需要安装与锁定 Playwright 对应的 Chromium（`npx playwright install chromium`）；WebGPU 测试还需要可用图形后端。真实 Preview Exporter 验收使用 `SCAD_PREVIEW_EXPORTER`，详细环境要求见 [当前验收报告](docs/preview-goldfeather-validation.md)。跨平台路径测试不能代替在 Windows、Linux 和 macOS 上分别运行原生程序。

`npm run format` 会格式化整个仓库，应只在明确需要时执行。局部整理优先对修改过的文件运行 Prettier，避免混入无关格式变更。

## 子模块、同步与打包

不要修改第三方源码或重新初始化同步基线来消除差异。Preview 同步必须显式运行 `npm run preview:sync -- status`、`to-ide` 或 `to-preview`；完整边界与冲突处理见 [同步说明](scripts/preview-sync/README.md)。删除同步树里的文件会保留为待同步差异，不应手工更新基线来隐藏它。

正式 VSIX 打包会调用 `vscode:prepublish`，构建当前平台的原生 LSP。需要按目标平台构建与验证；本机打出的二进制不是跨平台通用产物。检查 `.vscodeignore` 时保留 LICENSE、原始第三方声明、Webview 资源、WASM、worker 和 `server/<platform>-<arch>/`。
