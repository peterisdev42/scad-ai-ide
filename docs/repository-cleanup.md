# 仓库整理报告

日期：2026-11-03。范围：SCAD AI IDE 主仓库；三个 `sources/` 子模块仅核对入口、许可证及构建引用，不修改第三方源码。开始时工作区干净。本次未提交、推送或执行破坏性 Git 操作。

## 审计结论与整理方案

现有 `src/core`、`src/platform`、`src/features` 分层及 Preview 的 Host / shared / webview 边界基本合理，无须重组业务模块。主要问题是未使用文件、模板说明、文档根目录混放原始实验记录、历史状态与当前说明混淆、配置扫描范围过宽，以及开发与打包说明缺少统一入口。

实施前确定的最小方案：删除有引用证据支持的残留；集中原始验收资料并更新链接；保留既有模块与第三方管理边界；收紧源码扫描、整理忽略规则；通过类型、测试、构建和资源检查验证兼容性。风险主要是动态资源漏判、历史文档链接失效、同步基线误删，因此分别检查构建入口、Host 资源加载、文件引用和同步协议，并保留原始数据及基线。

额外发现并修复：Customizer 浏览器测试夹具未接入当前会话的性能模块；VSCE 因 manifest 缺少 repository 元数据而无法改写 README 链接。repository 地址直接采用已有 Git origin 的 HTTPS 形式，没有变更依赖或发布目标。

## 删除清单

| 文件                                                            | 删除依据                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `vsc-extension-quickstart.md`                                   | 生成器的 Hello World 模板；与现有命令、构建和测试流程不符，无文档入链；仅被 `.vscodeignore` 排除。由实际开发说明替代。 |
| `src/features/preview/shared/utilities/mapObject.ts`            | TypeScript 导入图、源码、脚本及资源检查均无调用；只有同步 state 留存历史路径。保留同步基线，让删除作为正常差异呈现。   |
| `src/features/preview/webview/components/main/BackendStatus.ts` | 无任何导入或入口注册，不在运行 bundle 中；现有浏览器测试明确断言不存在 `scad-backend-status` 元素。                    |

删除空的 `src/features/preview/shared/utilities/` 目录。其余文件不因名称、年代或未直接 import 而删除。

## 目录调整清单

以下 32 个文件从 `docs/<文件名>` 移至 `docs/artifacts/<文件名>`；逐一与 `HEAD` 原文件作二进制比较，内容完全相同。更新文档链接及报告中显式的输出路径，不改原始 JSON 的历史元数据。

- `csg-benchmark.json`
- `csg-customizer-latency.json`
- `csg-f5-1080p-highlightedBase-official.png`
- `csg-f5-1080p-highlightedBase-webgl2.png`
- `csg-f5-1080p-highlightedBase-webgpu.png`
- `csg-f5-1080p-throughHole-official.png`
- `csg-f5-1080p-throughHole-webgl2.png`
- `csg-f5-1080p-throughHole-webgpu.png`
- `csg-f5-1080p-webgl2.json`
- `csg-f5-1080p-webgpu.json`
- `csg-preview-tests.json`
- `csg-raster-1080p.json`
- `csg-raster-4k.json`
- `csg-raster-assembly-regression.json`
- `csg-ray-baseline-1080p.json`
- `csg-ray-baseline-4k.json`
- `csg-ray-baseline-initial-1080p.json`
- `preview-exporter-benchmark-webgl2.png`
- `preview-exporter-benchmark-webgpu.png`
- `preview-exporter-benchmark.json`
- `preview-exporter-legacy-baseline.json`
- `preview-goldfeather-benchmark-webgl2.png`
- `preview-goldfeather-benchmark-webgpu.png`
- `preview-goldfeather-benchmark.json`
- `preview-goldfeather-vscode-profile.json`
- `preview-goldfeather-vscode-profile.png`
- `preview-mesh-vscode-profile.json`
- `preview-mesh-vscode-profile.png`
- `preview-pipeline-benchmark.json`
- `preview-standard-mesh-benchmark-webgl2.png`
- `preview-standard-mesh-benchmark-webgpu.png`
- `preview-standard-mesh-benchmark.json`

没有移动源码、测试、脚本、PRD、子模块或静态运行资源。两个同名 `CustomizerPresets.ts` 分别承担数据处理和 VS Code 文件 I/O，保持原位置。

## 配置及组织优化

- 新增 [开发说明](../CONTRIBUTING.md) 与 [文档索引](README.md)，列出实际目录职责、验证入口、环境前提和打包流程。
- 标注早期架构研究为历史快照；移除对已不存在的生成文件 `server/darwin-arm64/provenance.json` 的无效超链接，保留历史路径文字。README 和快速预览入口改指当前 Goldfeather 验收报告。
- 两个 Preview 模块直接从 `Theme.ts` 导入 `Theme` 类型，消除经 `Stage` 间接导入的关系；不新增模块或抽象。
- `tsconfig.json` 显式包含 `src/**/*.ts` 与 `src/**/*.mts`，移除模板注释；Host / Webview 仍各自检查。排除已删除的无用文件后，新旧配置实际解析的 Host 文件集合相同，共 85 个文件。
- `.gitignore` 移除与本项目无关的框架模板项，保留 Node、产物、日志、环境、测试及同步规则，补充 VSIX、系统文件和格式缓存忽略。
- `.prettierignore` 补充原生构建、暂存程序、日志、VSIX 和原始验收资料，避免格式化生成目录或历史原始记录。
- `.vscodeignore` 移除不存在的模板文档及 `.yarnrc` 规则，保留运行时资源、许可证和原生程序。
- `package.json` 补齐与 Git origin 一致的 repository 元数据，修复 VSCE 对 README 相对链接的解析。npm scripts、依赖版本及锁文件不变。
- `scripts/customizer-scrollbar.test.mjs` 的 VM 测试夹具补入真实编译的性能模块和全局 `performance`。首次浏览器回归的 19 个初始化失败因此修复，不改产品逻辑或测试断言。

## 最终主要目录

```text
src/
  core/                 核心数据及 Runtime、Customizer、Preview 处理
  platform/             宿主、进程、网络及安装适配
  features/             VS Code 功能注册与界面
    preview/
      extension/        Host 会话、服务及编辑器
      shared/           共享协议和类型
      webview/          Lit、Three.js、Goldfeather
  test/                 单元、集成、编辑器入口及固定测试资料
scripts/                构建、测试、性能及手动同步工具
media/                  浏览器静态界面资源
resources/              扩展及语言图标
syntaxes/               TextMate 语法
snippets/               OpenSCAD 代码片段
examples/               用户与人工验证示例
docs/
  artifacts/            性能 JSON 和验收截图
  images/               用户文档插图
sources/                独立 Git 子模块
.preview-sync/          版本化的双向同步基线
```

生成目录 `dist/`、`out/`、`.build/`、`server/`、`licenses/`、`.vscode-test/` 已正确忽略。它们可能含有开发者本地实验或缓存，本次不清空这些目录。

## 验证结果

环境：macOS ARM64、Node.js 24.16.0、npm 12.2.0；使用已安装 VS Code 和 Playwright Chromium。浏览器首次在沙箱内因 macOS MachPort 权限被拒绝，获授权在沙箱外完成实际回归。

| 检查                                             | 结果                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check-types`                            | Host 与 Webview 均通过                                                                                                                                                                                                    |
| `npm run lint`                                   | 通过                                                                                                                                                                                                                      |
| `npm test`                                       | 129 个核心测试与 83 个 Preview 测试通过，无跳过                                                                                                                                                                           |
| `npm run test:preview-sync`                      | 19 项通过，含真实仓库快照往返测试                                                                                                                                                                                         |
| 四组浏览器测试                                   | Customizer、Markdown、快速预览、Prepared GPU 共 47 项通过，无跳过；真实覆盖 WebGPU 和 WebGL2                                                                                                                              |
| `npm run build:lsp`                              | 从当前子模块源码构建并暂存 `darwin-arm64` 程序成功                                                                                                                                                                        |
| `npm run package`                                | 类型、lint、生产 bundle 与第三方声明暂存通过                                                                                                                                                                              |
| VSIX 打包及内容检查                              | VSCE 执行完整 `vscode:prepublish` 后成功生成 `/tmp/scad-ai-ide-cleanup.vsix`（138 个文件、约 4.7 MB）；核实 manifest 与 Host 动态资源、WASM、worker、原始 LICENSE 和 32 份原始资料均完整，开发目录及 source maps 均未打入 |
| VS Code 集成测试                                 | 实际启动独立宿主；11 项通过，1 项失败：未设置 `SCAD_PREVIEW_EXPORTER`，无法执行原生 Markdown 导出器验收。真实 LSP 能力用例通过。不能视为整套通过                                                                          |
| 两个额外 Webview 宿主测试脚本                    | 3 项因缺少所需 `SCAD_*` 环境变量而跳过；不计为通过                                                                                                                                                                        |
| Bundle 对比                                      | 删除残留后，与整理前 9 个运行时 JS / CSS / WASM 文件的 SHA256 完全相同；随后对 Theme 的修改仅涉及类型导入                                                                                                                 |
| 原始资料对比                                     | 32 个移动文件均与 Git 原版本逐字节相同                                                                                                                                                                                    |
| 本地 Markdown 链接                               | 当前 Markdown 文档相对文件及目录目标检查通过；不验证历史行号是否仍代表当时内容                                                                                                                                            |
| `git diff --check`                               | 通过                                                                                                                                                                                                                      |
| 新增说明及修改的配置、测试夹具、类型导入文件格式 | Prettier 检查通过                                                                                                                                                                                                         |
| `npm run format:check`                           | 全仓仍有 14 个已有格式问题；已逐个使用 `git show HEAD:<文件>` 和同一 Prettier 配置确认原版本也不通过，未批量改写                                                                                                          |

浏览器实际执行命令：

```sh
node --test --test-force-exit --test-reporter=tap \
  scripts/customizer-scrollbar.test.mjs \
  scripts/markdown-preview.test.mjs \
  scripts/preview-fast.test.mjs \
  scripts/prepared-preview-gpu.test.mjs
```

## 保留问题与边界

- `discovery.ts` 与 `platformDiscovery.ts` 存在既有运行时循环导入：平台探测使用发现模块导出的候选构造及命令执行函数，发现模块调用平台探测。现有测试通过，本次不新增公共工具层或改动 Runtime 业务接口。
- `.preview-sync/state.json` 与 objects 是必需的版本化内容；不清除或重新初始化。删除共享工具和更改类型导入会正常显示为待同步差异，manifest / tsconfig 变化也可触发宿主配置提示；不自动反向同步或确认提示。
- 历史报告提到的旧脚本、旧性能指标与功能状态保持历史语境，入口索引已明确区分。两组内容相同的历史截图保留各自后端来源身份。
- PRD 中项目、库、积木和 AI 方向包含尚未交付能力；现有占位入口具有产品用途，不作为死代码删除。没有新增依赖管理实现。
- 当前仓库没有 `.github/` 工作流，因此没有 CI 路径可迁移或实际执行；不为本次整理新增流水线。
- Windows 和 Linux 的路径、归档及发现逻辑由已有测试覆盖，但本次没有这两个系统的真实 Extension Host / 原生构建环境。macOS 产出的 LSP 与 VSIX 不代表其他平台验收通过。
- 未提供原生导出器环境变量的集成验收仍未完成；不下载或安装新运行时来消除这个环境缺口。
