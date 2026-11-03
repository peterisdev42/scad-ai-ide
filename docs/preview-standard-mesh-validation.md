> 历史记录：本报告对应已删除的“先生成最终 Boolean 网格”方案及临时隐藏入口的改动。当前实现已改为 Goldfeather 图像空间预览并恢复切换入口，见 [当前架构](preview-exporter-architecture.md)。

> 当前界面调整：快速预览入口暂时隐藏，已有快速模式设置统一使用普通渲染；裁剪、线框、XRay 的切换入口已移除，保存的高级显示状态不再影响视口。下文保留 Exporter 内部实现与先前性能实验记录，不能代表所有实际模型的耗时。

# 标准 Mesh 快速预览验收

日期：2026-11-03；macOS ARM64、Apple M4 Pro、Chromium 149.0.7827.55。直接修改 `main`，无新分支或 PR。架构与协议见 [架构文档](preview-exporter-architecture.md)。

## 结果

快速模式仍由独立 Preview Exporter 生成 `.csgp`，在宿主中由同一原生可执行文件将官方 Products 一次性求值为最终表面，再与 STL/3MF 共用标准 `MeshStandardMaterial` / `ModelRepresentation.render`。没有逐帧 Boolean、旧 GPU CSG renderer、TS CSG Parser、Manifold WASM 快速求值或旧后端回退。

快速模式只提供基本实体显示。线框、XRay 和截面入口隐藏；已保存的高级状态不影响快速视口，切换到 Full Render 后仍可使用。选择和测量直接使用真实网格。颜色、Highlight、Background、相机、连续参数、未保存文档和依赖变化继续工作。

## 自动化验证

| 检查                                                     | 结果                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run package`：类型检查、Lint、生产构建、许可证      | 通过                                                                                  |
| `npm test`                                               | 129 个基础测试 + 79 个 Preview 测试通过                                               |
| 带真实 Exporter 和归档的 `npm run test:preview-exporter` | 10/10；下载校验、安装、发现、依赖、参数、取消、原生表面、空模型、RGBA 和覆盖层        |
| `scripts/prepared-preview-gpu.test.mjs`                  | 13 种模型 × WebGPU/WebGL2；每种每后端 132 个像素采样与 Products CPU 查询一致，均通过  |
| `scripts/preview-fast.test.mjs`                          | WebGL2 13/13；WebGPU 13/13                                                            |
| `scripts/markdown-preview.test.mjs`                      | 10/10                                                                                 |
| `npm run test:integration`                               | 真实 VS Code，12/12                                                                   |
| `scripts/test-preview-editor.mjs`                        | 未保存文本、Customizer、模式切换、独立 Exporter、真实 STL、3MF 错误、网格查看回归通过 |
| `scripts/markdown-webview.test.mjs`                      | 真实 VS Code，内置/扩展管理的 Webview 2/2                                             |

GPU 模型包含 Cube、Sphere、Cylinder、Union、Difference、Intersection、嵌套 Boolean、负缩放、复杂多边形、共面、薄壁和十亿级位移分离组件。真实相机拖动测试确认使用同一个标准模型表示、保持设备分辨率、没有几何请求；测试同时覆盖资源释放、并发替换和设备恢复。

测试网格由 `scripts/generate-preview-mesh-fixtures.mjs` 使用真实原生 Exporter 从同目录 `.csgp` 生成，可在没有原生 macOS 包的平台上运行 GPU 消费端回归。原生集成测试另外现场导出并求值，验证生产入口。

## 相机性能

[完整原始数据](artifacts/preview-standard-mesh-benchmark.json)。800×600、DPR 1、关闭阴影；每种模型每种格式采样 120 个相机帧，前 10 帧预热。中位数是浏览器 rAF 间隔，受刷新率限制，不能当作纯 GPU 执行时间。

| 模型                | 后端   | `.csgp` 标准 Mesh 中位数 / P95 | STL 中位数 / P95 |
| ------------------- | ------ | -----------------------------: | ---------------: |
| Cube                | WebGPU |                   8.3 / 9.1 ms |     8.3 / 8.9 ms |
| 嵌套 Boolean + 3 孔 | WebGPU |                   8.3 / 9.1 ms |     8.3 / 9.1 ms |
| 64 实例             | WebGPU |                   8.3 / 8.9 ms |     8.3 / 8.9 ms |
| Cube                | WebGL2 |                   8.3 / 9.0 ms |     8.3 / 8.6 ms |
| 嵌套 Boolean + 3 孔 | WebGL2 |                   8.3 / 9.2 ms |     8.3 / 8.9 ms |
| 64 实例             | WebGL2 |                   8.3 / 8.9 ms |     8.3 / 8.6 ms |

两种输入每帧 CPU 提交中位数约 0.1–0.3 ms，P95 约 0.5–0.6 ms；所有导航样本的几何查询次数为 0。这组测试中，相机交互与普通 STL 路径相当。

## 加载与参数更新代价

与此前 `a5cf241` 的逐片元 Boolean 路径作历史对照。旧值来自 [原始记录](artifacts/preview-exporter-benchmark.json)。两次运行时间不同，均为单次样本，不能视为统计显著的速度提升或退化结论。

| 模型                | 后端   | 旧首次 / 更新 | 标准 Mesh 首次 / 更新 | 新增原生表面求值 |
| ------------------- | ------ | ------------: | --------------------: | ---------------: |
| Cube                | WebGPU |    58 / 58 ms |           119 / 98 ms |         27–31 ms |
| 嵌套 Boolean + 3 孔 | WebGPU |   100 / 90 ms |          125 / 129 ms |         51–54 ms |
| 64 实例             | WebGPU |    66 / 67 ms |           84 / 113 ms |         29–35 ms |
| Cube                | WebGL2 |    89 / 83 ms |          135 / 129 ms |         29–30 ms |
| 嵌套 Boolean + 3 孔 | WebGL2 |  150 / 118 ms |          142 / 155 ms |         52–54 ms |
| 64 实例             | WebGL2 |    92 / 92 ms |          100 / 141 ms |         30–35 ms |

新增求值让初次/参数更新总体成本更高；其收益是把 Boolean 从每个相机帧移走。模型已经缓存时不重复原生求值。性能工具直接使用预览 Stage，不包含真实 IDE 消息通道及运行时发现的全部开销；生产端到端时间仍以视口确认的遥测为准。

## 限制

- 快速模式按最新需求不实现裁剪、线框和 XRay；Full Render 保留。
- 极端连通跨度、自交、非流形、复杂透明重叠尚未全面对照官方 F5；RGBA 使用标准 Three.js 混合及排序。v1 不提供逐面材质和源 AST。
- 原生表面求值可能较慢，当前每次子进程上限 60 秒；失败明确报错，不切回旧快速预览。
- 原生 Exporter 仅 macOS ARM64；其他平台明确不可用。
- 本机普通 RC0 构建 `lib3mf=false`，已验证真实 3MF 导出错误处理；STL 导出和已有 3MF 文档显示通过，未声称该构建成功导出 3MF。

## 复现

```sh
export SCAD_PREVIEW_EXPORTER=/absolute/package/bin/openscad-preview-exporter
export SCAD_PREVIEW_EXPORTER_ARCHIVE=/absolute/openscad-preview-exporter-macos-arm64.tar.gz
export SCAD_VSCODE_EXECUTABLE=/absolute/Code
export SCAD_OPENSCAD_EXECUTABLE=/absolute/ordinary/openscad
npm test
npm run test:preview-exporter
npm run test:preview-gpu
node --test scripts/preview-fast.test.mjs
SCAD_TEST_WEBGPU=1 node --test scripts/preview-fast.test.mjs
npm run test:integration
npm run test:preview-editor
npm run test:markdown-host
npm run benchmark:preview -- docs/artifacts/preview-standard-mesh-benchmark.json
```

Git 仅提交本次改造、测试、数据与文档。用户 `.DS_Store` 和未跟踪需求文档保持原样、未纳入提交；最终提交号见交付消息。
