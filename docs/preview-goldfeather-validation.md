# Goldfeather 快速预览验收

日期：2026-11-03。工作分支：`main`。算法和安装说明见 [架构说明](preview-exporter-architecture.md)。

## 交付边界

`.csgp` 的官方三角网格、实例、convexity 和 Products 直接进入 Goldfeather 深度/模板渲染。候选层、奇偶测试、裁剪和深度合并参考 OpenCSG 1.8.2 standard Goldfeather；没有重新执行实体 Boolean，没有将全部操作数简单叠加，也没有隐藏的旧后端。

删除 `.csgp` 最终表面物化模块 `materialize.ts`、`nativeSurfaces.ts`、`meshScene.ts`、`createPreviewMeshGroup.ts`、`preview-mesh-1` 协议、旧网格生成脚本及 17 份生成网格。旧 TypeScript CSG Parser、快速几何 Worker、Manifold 快速求值和归一化已在此前重构中移除。保留的 `mesh-topology-worker` / Manifold 只处理 Full Render / 导入网格的通用工具。

新增 `GoldfeatherRenderer.ts`、统一 `performance.ts`、逐阶段状态表与 Raw JSON / Output 记录；重写 ModelRepresentation、Stage、宿主 Exporter 调用与遥测。按用户确认恢复 CSG preview / Full mesh render 入口和 Exporter 安装/选择命令，默认仍为 Full Render。裁剪、线框、XRay 入口继续隐藏。

相机变化只绘制，不重新请求几何。快速模式保留表面拾取和点测量；精确边/顶点拓扑及投影阴影使用 Full Render。Goldfeather 候选与着色采用同一单采样目标，再呈现到视口，避免 MSAA 采样差异造成表面接缝；快速模式暂未实现后处理抗锯齿。

## 自动化验证

| 检查                                            | 结果与覆盖                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run package`                               | 宿主/浏览器 TypeScript、ESLint、生产 bundle 与许可证准备通过                                                                                  |
| `npm test`                                      | 基础 129 项、Preview 83 项通过                                                                                                                |
| `test:preview-exporter`（提供真实二进制与归档） | 9 项通过：固定 SHA256、发布 checksum、归档安装、独立能力与版本、未保存文本/参数/依赖、取消、空模型、实际 Products                             |
| `scripts/prepared-preview-gpu.test.mjs`         | 4 项通过；14 个模型 × 两种后端；差集/交集/嵌套、共享变换、大坐标、共面、薄壁、非凸多层；透视/旋转/相机位于减法体内；RGBA/空场景；逐像素完整性 |
| `scripts/preview-fast.test.mjs`                 | WebGL2 15 项、WebGPU 15 项通过：交互无几何请求、版本切换、缓存释放、设备恢复、拾取/测量、Highlight/Background、阶段表与隐藏控件               |
| `scripts/markdown-preview.test.mjs`             | 10 项通过：嵌入、主题、可见性与实例上限、暂停/恢复、源码 Tab 和原始 Products                                                                  |
| 真实 VS Code Markdown                           | 2 项通过：实际 Webview 首帧、刷新、Tab、连续绘制                                                                                              |
| 真实 VS Code 快速/普通切换                      | 1 项通过：`$preview` 快速立方体 30 / Full Render 10、真实差集孔、相机保持、冷启动与缓存全部阶段值有效、裁剪/线框/XRay 入口隐藏                |
| `npm run test:integration`                      | 11 项通过、1 项原生 Enter 输入失败                                                                                                            |
| 真实 Preview 编辑器回归                         | 未保存文档、参数/预设、依赖路径、原生 STL/3MF 查看、导出通过；本机 CLI 缺少 lib3mf，3MF 导出验证的是明确错误路径                              |

GPU 像素测试将屏幕可见性与独立 CPU Products 射线查询比较。常规模型每幅图检查 132 个点；接缝回归对倾斜差集与交集的 128×128 全部像素比较，两种后端都覆盖输出 MSAA 目标。CPU 查询仅作为测试 oracle 和拾取工具，不承担快速渲染求值。

真实 Exporter 为固定 `openscad-2026.11-RC0` macOS ARM64，Schema 1；SHA256 为 `42ebdbe75f3d8bf25c61675f756c86206b6a14077a5ea078fad355babf69a14f`。无 CLI 的自动化环境会跳过真实运行时部分，本次验收明确传入已校验的二进制与归档。

集成测试中原生 Enter 输入没有改变文档，保留为失败，没有跳过。在临时目录 `git archive HEAD`、独立构建改造前版本、使用全新 VS Code profile 单独运行原始 Enter 用例，复现同样的 `if (enabled)` 未插入换行失败；本次未改语言实现或降低断言。Markdown 旧 `stl` 断言已按生产实际 `binstl` 更新，相关集成用例通过。

## 基准方法与结果

Apple M4 Pro，Chromium 149.0.7827.55，800×600、DPR 1，关闭阴影和环境，六种模型，首次/缩放参数变化各一次，两种后端共 24 个样本。每次重新启动 Exporter，随后读取/解析/准备、传输、GPU 准备和首帧确认；不含完整 VS Code 发现、watcher、编辑器调度和防抖，因此与用户观测的整体耗时不等价。单次样本受 shader/驱动缓存和调度影响，不能作为稳定统计结论。

相机基准为四种模型 × `.csgp` / STL × 两种后端，每组 120 帧，排除前 10 帧。STL 比较用于导航，不把从同一 Exporter 导出的 STL 当作正常 CLI 的端到端时间。全部组的几何查询数为 0。

原始数据：[本次基准](artifacts/preview-goldfeather-benchmark.json)。历史基线：[旧原生最终网格物化流程](artifacts/preview-standard-mesh-benchmark.json)。两次采样不是同一进程、不是成对统计；历史格式只保存较粗的阶段数据。下表由原始数据生成，单位 ms，单元格为“首次 / 参数更新”。

| 模型                | 旧物化 WebGPU |   当前 WebGPU | 旧物化 WebGL2 |   当前 WebGL2 |
| ------------------- | ------------: | ------------: | ------------: | ------------: |
| 立方体              |  119.3 / 97.8 |   64.5 / 73.3 | 135.4 / 129.4 |  97.1 / 107.1 |
| 嵌套 Boolean / 3 孔 | 125.0 / 128.9 |   84.4 / 98.1 | 142.4 / 155.5 | 917.4 / 131.5 |
| 64 实例             |  83.7 / 113.5 |   66.0 / 79.7 |  99.9 / 140.7 |  83.2 / 108.7 |
| 16 个差集           |   83.1 / 83.2 | 118.7 / 124.3 |  100.1 / 99.8 | 124.8 / 118.0 |
| 25 孔差集           |             — | 117.7 / 133.3 |             — | 133.1 / 164.8 |

最终采样中 WebGL2 复杂模型首次耗时 917.4 ms，其中 shader/pipeline 准备为 833.2 ms；参数更新为 131.5 ms。这一冷启动慢样本保留在报告中，没有通过重跑筛掉。

复杂 Boolean 并不保证整体更快：例如 16 个差集网格需要更多 Goldfeather pass，在本次样本中慢于历史最终网格。首次 shader 准备也可能抵消省去实体物化的收益。大量 Boolean 绘制提交仍是下一步优化目标，当前尚未实现 OpenCSG Automatic/SCS、occlusion query 或完整批次优化。

相机帧间隔中位数在所有 `.csgp` 和 STL 组中均为 8.3 ms（约 120 Hz）。`.csgp` CPU 绘制提交中位数为 0.2–2.8 ms，P95 最高 3.1 ms；STL 更轻。这个差异在 25 孔模型尤其明显，不能把帧间隔相同理解为 GPU 成本相同。

不能据此断言用户此前 20–30 秒的具体模型已经降至某个时间；该模型未提供。本次提供左下角完整阶段表、可复制 Raw JSON 和 **SCAD AI IDE Preview** Output 的 `[Preview pipeline]` 日志，用于在该模型上定位瓶颈。

## 时间含义

Exporter 为外部进程整体时间，协议没有其内部几何求值/三角化的独立计时。上传和 Boolean/着色记录 CPU 提交；shader 准备记录墙钟；GPU completion 为队列/readback 等待，不是纯 GPU timestamp。首帧包含 GPU 确认及浏览器帧回调，不能直接断言显示器已经扫描输出。

宿主总时间来自同一时钟，传输/调度为扣除已知阶段后的估算；小计存在重叠，不可把所有行相加。缓存明确跳过的阶段为 0，尚未测到的值为 `—`。内置 Markdown 没有完整首帧宿主确认时不捏造总时间。

[真实 VS Code 阶段 JSON](artifacts/preview-goldfeather-vscode-profile.json) 和 [面板截图](artifacts/preview-goldfeather-vscode-profile.png) 是缓存复用示例，不能当作冷启动性能数字。

## 尚未全面验证或实现

- 现有原生 Enter 宿主用例在本机仍失败，改造前 HEAD 同样复现；全量集成测试为 11 通过 / 1 失败。
- standard Goldfeather 依赖正确 convexity，当前 stencil 层数超过 255 时明确拒绝；没有静默截断或旧实现回退。
- 不生成精确最终实体拓扑；边/顶点测量和阴影要求 Full Render。裁剪/线框/XRay 按用户要求隐藏。
- 一般 2D Boolean、极端非流形/自交、复杂透明叠加、全部显卡/驱动尚未全面验收。多边形三角化用例是挤出后的 3D 几何。
- 光照采用 Three.js PBR，不保证与官方 OpenGL 的颜色/透明像素逐一一致。
- 不是完整 OpenCSG 库移植；Automatic/SCS/occlusion 与后处理抗锯齿尚未实现。
- 本机普通 CLI 没有 lib3mf，成功的原生 3MF 导出需要具有此能力的 CLI；既有 3MF 文件查看通过。
- Exporter 目前只有 macOS ARM64；其他平台快速预览明确不可用，Full Render 保留。

## 复现

```sh
npm run package
npm test
SCAD_PREVIEW_EXPORTER=/absolute/bin/openscad-preview-exporter \
  SCAD_PREVIEW_EXPORTER_ARCHIVE=/absolute/exporter.tar.gz npm run test:preview-exporter
npm run test:preview-gpu
node --test scripts/preview-fast.test.mjs
SCAD_TEST_WEBGPU=1 node --test scripts/preview-fast.test.mjs
node --test scripts/markdown-preview.test.mjs
SCAD_PREVIEW_EXPORTER=/absolute/bin/openscad-preview-exporter \
  npm run benchmark:preview -- /tmp/preview-benchmark.json
```

真实宿主测试需设置 `SCAD_VSCODE_EXECUTABLE`、`SCAD_OPENSCAD_CSG_EXECUTABLE` 和 `SCAD_PREVIEW_EXPORTER`；执行 `scripts/preview-switch-webview.test.mjs`、`scripts/markdown-webview.test.mjs`。可用 `SCAD_PREVIEW_PROFILE_OUTPUT=/tmp/profile.json` 保存切换后的完整缓存阶段数据和 PNG。
