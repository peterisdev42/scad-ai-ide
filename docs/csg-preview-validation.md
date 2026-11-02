# CSG 光栅化预览验收（2026-11-02）
本文保留交互调度优化前的性能基线。后续分支合并与问题修复的验证见 [交互分支合并验收](csg-preview-merge-validation.md)；省略交互帧 fence 后的 CPU 提交时间不能与本表 GPU 完成时间直接比较。

实现与管线图见 [CSG Preview](csg-preview.md)，官方代码依据和 Three.js API 实验见 [源码审计](csg-preview-research.md)。本记录只描述实际执行的环境和用例，不声称完整复刻所有 OpenSCAD F5 行为。

## 测量方法

同一台 Apple M4 Pro，以 Chromium 149.0.7827.55、Three.js 0.187.0、OpenSCAD 2026.10.27 测量。WebGPU 的公开 adapter 信息为 Apple / metal-3；WebGL 2 通过 `WebGPURenderer({forceWebGL:true})` 运行。物理附件尺寸分别为 1920×1080、3840×2160，非 CSS 缩小视口。

修改前已记录 [首次基线](csg-ray-baseline-initial-1080p.json)。最终比较在相同基准程序中依次运行原实现源码快照和最终实现；快照位于不打包的 `.build/csg-audit-baseline`，运行时不保留另一套 Renderer。每个模型、后端各记录 20 次实际相机旋转，每次旋转 0.015 弧度；P50/P95 对保存的样本作线性插值。这是短程交互基准，不能替代长期热稳定性测试。

每帧等待真实渲染目标读回，以确认之前的 GPU 工作完成；不使用已被 r187 移除的 `waitForGPU()`。只有 1 像素完成标记读回，布尔可见性不在 CPU 求解。首次及更新画面额外等待两次 rAF，记录呈现机会；没有直接测量操作系统扫描到物理屏幕的时间。

原实现的 `waitForGPU()` 控制台错误次数完整保留；原实现 200 个重复图元的 WebGPU Shader 编译失败也保留为失败，没有填入帧时间。原有 [96×96 历史记录](csg-benchmark.json) 已明确标注不适用于性能验收。

原始数据包含 CLI、Worker 总耗时、局部几何、规范化、GPU 上传/预热、Shader 准备、首次 GPU 帧、首次画面、全部旋转样本、编辑更新和 Three.js 资源计数：

- [旧实现 1080p](csg-ray-baseline-1080p.json)、[新实现 1080p](csg-raster-1080p.json)
- [旧实现 4K](csg-ray-baseline-4k.json)、[新实现 4K](csg-raster-4k.json)

`shaderMs` 是准备阶段减去上传/预热的墙钟时间；`uploadMs` 也包含预热绘制所需的后端工作，并非硬件计时器分离出的纯 DMA 时间。`firstPresentedMs` 从浏览器开始准备模型计算，不含 CLI/Worker 和 Renderer 初始化。`customizerTransformUpdateMs` 是分别测量的 host 与浏览器阶段之和，不冒充真实 VS Code 输入延迟。真实 Customizer 测量另列。

## 实测帧时间

每格为 **P50 / P95，毫秒**；包含 GPU 完成等待和提交画面所需的浏览器工作，不是纯 Shader 硬件时间。

### 1920×1080

| 模型 | 旧 WebGPU | 新 WebGPU | 旧 WebGL 2 | 新 WebGL 2 |
| --- | ---: | ---: | ---: | ---: |
| Cube − Sphere | 58.10 / 58.56 | 2.65 / 4.32 | 75.00 / 75.81 | 16.70 / 17.50 |
| 嵌套 Intersection / Difference | 63.95 / 67.43 | 5.60 / 7.21 | 91.70 / 100.01 | 17.05 / 25.15 |
| 九个 Cylinder 通孔 | 53.45 / 56.32 | 7.60 / 10.97 | 66.70 / 66.80 | 25.00 / 25.10 |
| 200 个重复 Cube | Shader 编译失败 | 2.55 / 3.61 | 58.35 / 58.50 | 16.60 / 17.51 |
| 非凸局部操作数 | 50.40 / 51.41 | 4.80 / 8.00 | 50.00 / 50.11 | 25.00 / 33.44 |
| 扭转挤出参与 Difference | 50.90 / 52.98 | 6.35 / 7.44 | 49.90 / 50.11 | 33.20 / 34.40 |
| 金字塔 Polyhedron | 51.35 / 52.56 | 3.70 / 5.90 | 50.00 / 58.20 | 24.90 / 26.00 |
| 凹星形 Polyhedron | 46.25 / 47.82 | 6.05 / 8.08 | 41.60 / 41.80 | 33.25 / 34.22 |
| MCAD 齿轮 | 55.50 / 58.48 | 17.25 / 19.69 | 58.10 / 59.50 | 25.70 / 41.61 |
| Hull 圆角外壳 | 61.10 / 63.32 | 4.95 / 5.80 | 91.50 / 92.60 | 24.90 / 26.01 |

### 3840×2160

| 模型 | 旧 WebGPU | 新 WebGPU | 旧 WebGL 2 | 新 WebGL 2 |
| --- | ---: | ---: | ---: | ---: |
| Cube − Sphere | 701.40 / 741.54 | 3.95 / 10.22 | 266.70 / 274.90 | 25.00 / 25.71 |
| 嵌套 Intersection / Difference | 704.75 / 710.91 | 10.15 / 10.63 | 333.35 / 341.85 | 33.30 / 33.44 |
| 九个 Cylinder 通孔 | 690.10 / 706.81 | 14.60 / 15.13 | 241.65 / 257.67 | 33.40 / 41.70 |
| 200 个重复 Cube | Shader 编译失败 | 2.70 / 4.48 | 216.65 / 217.70 | 16.70 / 18.15 |
| 非凸局部操作数 | 698.70 / 735.89 | 8.20 / 9.90 | 199.90 / 200.44 | 33.30 / 34.02 |
| 扭转挤出参与 Difference | 696.35 / 735.05 | 8.70 / 10.33 | 175.00 / 175.15 | 33.30 / 34.20 |
| 金字塔 Polyhedron | 692.95 / 700.92 | 5.85 / 6.60 | 207.80 / 208.45 | 25.60 / 33.35 |
| 凹星形 Polyhedron | 685.20 / 696.44 | 8.50 / 10.80 | 150.05 / 158.40 | 33.30 / 33.64 |
| MCAD 齿轮 | 697.90 / 709.81 | 22.05 / 23.38 | 216.70 / 232.16 | 58.30 / 58.95 |
| Hull 圆角外壳 | 713.05 / 750.93 | 7.05 / 8.43 | 317.65 / 325.11 | 25.00 / 25.90 |

## 准备、首次显示与编辑更新

以下取新实现 1080p WebGPU 的原始记录。CLI、局部几何和 Worker Product 规范化分列；Worker 总时间还包含启动与 WASM 初始化。浏览器共因子准备计入首次显示，未单独分离。单位毫秒。

| 模型 | CLI | 局部几何 | Product 规范化 | GPU 上传/预热 | Shader 准备 | 浏览器首次画面 | 缓存编辑 host+画面 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cube − Sphere | 25.94 | 7.04 | 0.15 | 9.30 | 40.70 | 198.50 | 88.97 |
| 嵌套 Intersection / Difference | 40.90 | 8.85 | 0.22 | 6.60 | 38.50 | 84.00 | 81.28 |
| 九个 Cylinder 通孔 | 40.92 | 5.28 | 0.25 | 6.20 | 39.20 | 90.00 | 91.78 |
| 200 个重复 Cube | 25.98 | 7.13 | 1.74 | 6.50 | 38.60 | 110.70 | 111.52 |
| 非凸局部操作数 | 25.07 | 8.85 | 0.17 | 6.60 | 39.20 | 108.30 | 83.61 |
| 扭转挤出参与 Difference | 31.59 | 9.64 | 0.16 | 6.40 | 42.80 | 114.80 | 81.32 |
| 金字塔 Polyhedron | 35.32 | 6.77 | 0.14 | 7.30 | 39.70 | 91.80 | 80.39 |
| 凹星形 Polyhedron | 25.20 | 5.11 | 0.14 | 6.80 | 38.70 | 110.80 | 85.50 |
| MCAD 齿轮 | 35.36 | 16.21 | 0.20 | 6.70 | 40.10 | 126.30 | 104.86 |
| Hull 圆角外壳 | 35.01 | 8.53 | 0.18 | 6.40 | 38.70 | 84.20 | 90.96 |

相机交互在本次模型集中显著改善，首次显示并非全部改善。例如 1080p 球体差集的浏览器首次画面由 145.70 ms 变为 198.50 ms，额外光栅 Pass 的 Shader 准备仍有成本。4K MCAD 齿轮的 WebGL 2 P50 仍为 58.30 ms，不能宣称所有模型达到 60 FPS。

Three.js `info.memory.total` 是记录时已分配资源的估算，不是物理 GPU 驻留内存或进程 RSS。复杂布尔模型的屏幕附件增加，以下为球体差集 WebGPU 的资源快照：

| 分辨率 | 旧估算 MiB | 新估算 MiB |
| --- | ---: | ---: |
| 1080p | 55.66 | 110.89 |
| 4K | 221.78 | 443.11 |

球体差集的模型传输从 192,460 降为 40,199 字节，去除了 GPU 加速结构和重复三角形数据。未测量进程 RSS、驱动真实驻留内存或设备功耗；不能根据这些资源估算宣称总内存下降。

## 真实 Customizer 到画面

在 VS Code 1.144.0 / Chromium 150.0.7871.250 中，对 Cube 宽度作十次不命中旧结果的尺寸修改，实际 WebGPU 画布 1690×1352。P50 **104.00 ms**、P95 **110.55 ms**。计时从真实 extension host 的 `CustomizerService.set(width,value,'input')` 开始，经过 CLI、Worker、Webview、GPU 完成、两次 rAF、host 确认；包含轮询/确认开销，不包括 DOM 手势派发。[全部样本](csg-customizer-latency.json)。没有相同方法的旧实现 Customizer 记录，因此不宣称此指标的改善倍数。


## 官方 F5 对照

官方 CLI 使用 `--preview=opencsg`、1920×1080、固定摄像机、22.5° 透视 FOV、相同分面参数。十个模型包含多层嵌套、通孔、非凸 render 屏障、挤出、凹多面体、MCAD 齿轮、嵌套 `%` 和高亮差集。在 WebGPU、WebGL 2 均通过轮廓比较，排除参考轮廓两像素边缘带。没有逐像素匹配颜色或光照。

[WebGPU 对照明细](csg-f5-1080p-webgpu.json)、[WebGL 2 对照明细](csg-f5-1080p-webgl2.json) 保留每模型结果；普通通孔与高亮差集的三份原始 PNG 链接见 [实现文档](csg-preview.md)。官方 `officialProcessMs` 包含整个 CLI 进程导出，不是 Qt IDE 的 F5 首帧或旋转时间。未测量官方 Qt IDE 连续旋转帧率。

## 自动化回归

| 命令 / 场景 | 最终结果 |
| --- | --- |
| `npm test` | 129 基础 + 84 Preview = 213 通过 |
| `SCAD_OPENSCAD_CSG_EXECUTABLE=… npm run test:csg-gpu` | 46 通过：44 光栅测试 + 2 后端 × 10 官方模型 |
| `SCAD_GPU_WIDTH=3840 SCAD_GPU_HEIGHT=2160 node --test scripts/csg-raster.test.mjs` | 44 通过 |
| `node --test scripts/preview-fast.test.mjs` | 11 通过（WebGL 2） |
| `SCAD_TEST_WEBGPU=1 node --test scripts/preview-fast.test.mjs` | 11 通过（WebGPU） |
| `SCAD_OPENSCAD_CSG_EXECUTABLE=… node --test scripts/csg-native.test.mjs` | 45 通过，2 跳过（当前 CLI 无 roof / 3MF import） |
| `npm run test:preview-sync` | 19 通过 |
| `SCAD_VSCODE_EXECUTABLE=… SCAD_OPENSCAD_CSG_EXECUTABLE=… node scripts/test-preview-editor.mjs` | 6 组集成断言通过，实际 STL / CSG、3MF 文件夹具 |
| `SCAD_VSCODE_EXECUTABLE=… SCAD_OPENSCAD_CSG_EXECUTABLE=… node --test scripts/preview-switch-webview.test.mjs` | 1 通过（实际 VS Code） |
| `SCAD_VSCODE_EXECUTABLE=… SCAD_OPENSCAD_CSG_EXECUTABLE=… node --test scripts/csg-customizer-latency.test.mjs` | 1 通过，10 次实际尺寸修改 |
| `SCAD_VSCODE_EXECUTABLE=… node --test scripts/markdown-webview.test.mjs` | 2 通过（实际 VS Code 内置及自管） |
| `node --test scripts/markdown-preview.test.mjs` | 8 通过 |
| `npm run test:csg-coverage` | 22 个固定 serializer 检查通过 |
| `npm run package` | 类型、lint、production bundle、许可证准备通过 |
| `node scripts/verify-csg-package.mjs .build/artifacts/scad-ai-ide-raster-preview.vsix` | 隔离 VSIX Worker / Product、无 GPU BLAS/TLAS、字体、roof、许可证检查通过 |

[机器可读记录与用例名称](csg-preview-tests.json)。实际 VS Code 使用 1.144.0 / Chromium 150.0.7871.250；浏览器独立 GPU 测试使用 Chromium 149.0.7827.55。测试设备恢复为回调模拟，不是物理设备复位。

Editor 夹具的共享 CLI 日志竞争与两个遗留 v2 schema 断言已经修正后重跑；没有通过取消断言或放宽像素容差隐藏失败。VSIX 本地打包使用 `--no-dependencies --allow-missing-repository --no-rewrite-relative-links`，不发布到外部服务。

GPU 像素测试比较轮廓和真实深度，覆盖交/并/差、多操作数、九通孔跨 Stencil 批次、嵌套、正交/透视、内部相机、非凸、挤出、凹多面体、镜像/非均匀缩放、接触/重合、大平移、薄壁、遮挡、颜色及修饰符。另有超出 64 层时受控失败与减法内壁方向光断言。

深度判定容差为 3e-6，并允许参考表面两像素邻域中的深度范围，以容纳交线处不同三角化的光栅边缘。Normalizer 单元测试以随机 DAG 的全部真值组合验证代数变换，还验证有界膨胀和深链不递归。

原生 CLI 对照的两个跳过项目是 roof 和 3MF：当前安装的 OpenSCAD 二进制不提供相应功能。项目内局部几何/导入单元测试仍覆盖它们。独立 Full Render 的实际 STL 导出已测试；原生 3MF 导出未在此环境验证，不能声称通过。

## 兼容性与代价

普通相机运动不执行最终实体 Boolean。精确 Wireframe、测量、X-Ray、剖切封口按需请求结果拓扑；回到 Solid 后，后续普通更新不再因历史工具请求执行最终 Boolean。内置 Markdown 无 host 拓扑通道，会明确引导使用带 3D 工具的自管预览。

CSG 基础路径不支持原有射线阴影、HDR 环境 PBR、任意交错透明层的精确排序；Full Render 保留相应模型显示能力。规范化、条件项、三角形、Pass、附件和非凸层数均有明确预算，超限保留最后完整帧并诊断。

设备丢失测试调用真实 Renderer 的恢复回调，验证受控 WebGL 2 重建、相机/模型/设置保留和资源释放；没有主动重置物理 GPU。未覆盖 Safari、Firefox、Windows/Linux、独立显卡和所有 OpenSCAD 库。远裁剪面截断分类操作数、任意自相交/非流形输入和极端尺度组合仍不在已验证范围内。
