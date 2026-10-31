# F5 源码审计与 API 实验（2026-10-31）

本次已实际替换 GPU 射线实现；实现、验收和限制见 [CSG Preview](csg-preview.md)。本文保留设计依据，不代表额外维护一套 Renderer。

## 来源

本地 `sources/openscad` 固定在 `fe482c342ea48bbe749563315741d0e58cdfd57f`，工作树干净。虽然子模块 remote 使用 fork，该提交也已通过 GitHub API 在官方 [openscad/openscad](https://github.com/openscad/openscad/commit/fe482c342ea48bbe749563315741d0e58cdfd57f) 验证。审计读取以下实际代码：

| 官方文件 | 对本实现的约束 |
| --- | --- |
| `src/gui/MainWindow.cc` | `actionRenderPreview → csgRender → compileCSG`；F6 独立进入 `GeometryWorker` |
| `src/core/CSGTreeEvaluator.cc` | 从实例化节点树准备局部几何；变换、颜色和预览修饰符独立传递 |
| `src/geometry/GeometryEvaluator.cc` | 挤出、hull、minkowski、render 等局部几何屏障仍需 CPU 求值 |
| `src/glview/preview/CSGTreeNormalizer.{cc,h}` | 精确布尔代数转换与有界展开；不是简单顺序绘制 |
| `src/core/CSGNode.cc` | `CSGProducts::import` 将已规范化的表达式组织为交、减操作数集合 |
| `src/glview/preview/OpenCSGRenderer.{cc,h}` | `OpenCSG::render` 先写可见深度，再以 `GL_EQUAL` 着色；减法背面及凸性影响调度 |
| `src/glview/preview/ThrownTogetherRenderer.cc` | 降级为原始操作数显示不能冒充正确的布尔结果 |
| `src/gui/GeometryWorker.cc` | F6 对根几何完整求值，不应成为普通 F5 的前置任务 |
| `src/glview/PolySetRenderer.cc`、`src/glview/cgal/CGALRenderer.cc` | 已求值网格的显示与图像空间 CSG 不同 |
| `src/glview/GLView.cc`、`src/gui/QGLView.cc` | 相机变化调用既有 renderer；无需重跑解析与几何求值 |

OpenCSG 使用官方 [1.8.2 源码包](https://www.opencsg.org/OpenCSG-1.8.2.tar.gz)，SHA-256 为 `5ac5df73b1ad3340dd6705ff90e009f1a946bb9536c21c2263a6f974265664c0`。读取了 `renderGoldfeather.cpp`、`renderSCS.cpp`、Primitive 和深度/模板辅助实现，并参照 [官方用法和算法说明](https://opencsg.org/) 与 [作者论文](https://www.opencsg.org/data/csg_freenix2005_paper.pdf)。

Goldfeather 对候选表面作奇偶分类；从远端计数可避免近裁剪面和内部相机破坏初始内部状态。普通实现用凸性提示决定层数，分层/查询变体可验证实际层数。SCS 用交集深度初始化、减法前后面推进、ID 缓冲及访问序列求稳定结果，其基本限制是凸操作数。因此这里选用分层 Goldfeather，未引入另一个 SCS 后端。

CLI `.csg` 是实例化树的文本，不含官方规范化后的 Product/VBO。项目继续使用原 Parser 和 Geometry Kernel，新增自己的规范化与 Product 准备步骤。

## Three.js 的实际验证

执行时 `npm view three version` 返回 **0.187.0**，与依赖锁一致；类型包锁定为 0.186.0。核对了已安装源码中的 `Renderer`、WebGPU/WebGL 后端、`WebGPUPipelineUtils`、`TextureNode`、`ScreenNode` 和 `ViewportDepthNode`，并用真实浏览器验证。

- `WebGPURenderer({forceWebGL:true})` 实际运行相同的光栅、Stencil、DepthTexture、TSL 逻辑，不建立传统 WebGLRenderer。
- 默认后端的 `init()` 失败会通过 Three.js 内置 fallback 尝试 WebGL 2。Stage 的设备恢复保留现有模型/相机并重建视图；视角立方体同步继承 `forceWebGL`。
- 深度/模板状态通过公共 Material 属性配置。正反面使用相同的 Stencil 反转操作，每批使用最多八位，之后清空重用。
- **Depth32Float 不能同时声明独立 Stencil aspect。** 最小实验将 `DepthTexture(FloatType)` 与 `stencilBuffer:true` 组合后，WebGPU 明确报 `stencilLoadOp ... attachment ... Depth32Float ... has no stencil aspect`，WebGL 2 也无法形成有效附件。本实现分开使用只读候选 Depth32Float 目标、Depth/Stencil 分类目标和成员状态颜色目标，避免采样正在写入的附件。无需修改 Three.js Backend。
- **r187 的 `waitForGPU()` 已移除。** 旧代码调用只打印错误。所有最终性能统计改用实际渲染目标的异步单像素读回等待队列完成；首次画面通知另等两次 rAF。基线保留旧调用的错误次数，没有把其 JavaScript 提交时间当作完整帧时间。
- `screenCoordinate` 与 `textureLoad` 使用 Three.js 自身的后端坐标处理；无需手写 GL/WGPU 两份算法。测试原始读回图像仅在比较 PNG 时统一上下方向。

## 复用与替换

保留 Parser、资源与依赖解析、字体、局部 WASM 几何、取消/超时/堆限制、Customizer、STL/3MF Full Render、相机与交互、精确拓扑服务。

新增精确 DNF Normalizer、Product 中间结构、双侧成员状态合成、非凸深度层数验证和完整帧发布。CPU 拾取 BVH 保留，但第一次查询时才创建，既不预生成也不通过 Preview 传输。

移除旧 `CsgModel` 的 GPU 射线/三角形求交、BLAS/TLAS 数据纹理、流式 Hit Event 布尔着色器、CSG 射线阴影、GPU Buffer 打包器、r187 `overrideNodes` 特例和逐 Tile 调度。`CsgFramePass` 只负责完整帧发布；`Stage` 不包含布尔深度算法。源码快照仅用于本地基线复测，位于忽略且不打包的 `.build/`，运行时没有旧算法选择项。
