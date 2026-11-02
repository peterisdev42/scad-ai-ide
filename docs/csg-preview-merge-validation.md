# CSG 交互延迟分支合并验收（2026-11-02）

合并来源为 `fix/csg-preview-interaction-latency-20261102`（`f606ab5`），目标 main 的原提交为 `832e082`。合并前发现的架构与显示回归已修复；main 的固定正面/背面 NodeMaterial 着色修复保留。

## 最终行为

- 保留实际相机拖动时的临时 DPR 降低、免除每交互帧完成读回、相机专用失效签名，以及松开后的完整分辨率/场景状态检查。静止帧及首帧仍确认 GPU 完成；提交耗时不冒充 GPU 完成帧时间。
- 保留统一左下角状态栏、可展开性能详情、错误 alert、CLI 错误与正常空模型的区分。
- 删除工作量超过 400、两次慢帧、预算错误等情况下的自动完整 Boolean 回退。普通 F5 和内置 Markdown 均不隐式计算最终网格；超出硬预算明确诊断，由用户选择简化模型或独立 Full Render。
- Highlight/Background 留在操作数光栅化路径，不再因自动回退丢失。25 通孔模型超过原阈值时仍不发送 `queryTopology`。
- 用户启用 Wireframe、X-Ray、精确测量或剖切时才请求拓扑。取消最后一个剖切面后，恢复光栅化和未裁切的面拾取；取消期间完成或失败的旧请求不能覆盖画面、显示过期错误或触发新的完整拓扑请求。
- 保留后端无关的边界准备与保守工作量估算，以及 50,000 工作量硬保护。精确工具的 `topologyRequestMs` 经过有限、非负验证后传回状态详情；删除不再使用的预计算回退耗时字段。

## 自动化结果

环境：macOS / Apple M4 Pro / Metal；独立 Chromium 149.0.7827.55，VS Code 1.144.0 / Chromium 150.0.7871.250。WebGPU 与 WebGL 2 分别运行，GPU 像素测试实际使用 `WebGPURenderer({forceWebGL:true})` 验证 WebGL 2。

| 命令或场景 | 结果 |
| --- | --- |
| `npm test` | 129 基础 + 88 Preview = 217 通过 |
| `npm run package` | 类型、lint、production bundle、许可证准备通过 |
| `SCAD_TEST_WEBGPU=1 node --test scripts/preview-fast.test.mjs` | 20 通过 |
| `node --test scripts/preview-fast.test.mjs` | 20 通过（WebGL 2 降级） |
| `npm run test:csg-gpu`（真实 OpenSCAD） | 46 通过，包括两后端各十个官方 F5 模型 |
| `SCAD_GPU_WIDTH=3840 SCAD_GPU_HEIGHT=2160 node --test scripts/csg-raster.test.mjs` | 44 通过 |
| `node --test scripts/markdown-preview.test.mjs` | 10 通过 |
| `node scripts/test-preview-editor.mjs`（实际 VS Code、真实 CLI） | 6 组集成断言通过 |
| `node --test scripts/preview-switch-webview.test.mjs`（实际 VS Code） | 1 通过 |
| `node --test scripts/markdown-webview.test.mjs`（实际 VS Code） | 2 通过 |
| `node --test scripts/csg-customizer-latency.test.mjs`（实际 VS Code、真实 CLI） | 1 通过，十次尺寸更新 |
| `npm run test:preview-sync` | 19 通过 |
| `npm run test:csg-coverage` | 22 个固定 serializer 检查通过 |

需要真实应用的命令设置 `SCAD_VSCODE_EXECUTABLE`；需要 CLI 的命令设置 `SCAD_OPENSCAD_CSG_EXECUTABLE`。实际 STL 导出和 STL/3MF 文件打开通过；当前 CLI 不提供原生 3MF 导出，此项未验证。

## 新增回归覆盖

`preview-fast.test.mjs` 验证真实的 25 通孔及 `#`/`%` 图层、连续慢帧、预算错误、显式工具失败、关闭最后一个剖切面后的显示及拾取、取消期间拓扑成功/失败的过期处理。预算错误保持原画面的断言只排除预期变化的状态栏 DOM，不放宽几何像素比较。

Markdown 覆盖复杂模型的 CSG 传输不携带预计算拓扑，以及旧缓存即使带拓扑也只有明确启用工具才使用。离屏暂停测试等待已经提交的 CSG 帧结束后，验证不再提交新帧，避免将合法在途绘制误判为未暂停。

## 测量边界

历史 1080p/4K 性能数据仍见 [光栅化基线验收](csg-preview-validation.md)。本次验证了交互调度策略和无隐式 F6 的行为，没有重新宣称输入到物理显示的延迟改善倍数。其他操作系统、Safari/Firefox、物理 GPU 重置和任意复杂 CSG 输入仍未完整验证。
