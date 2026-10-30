# CSG 预览回退日志调查

调查日期：2026-10-30。对象为当前工作树，不代表已发布版本。

## 结论

**补多边形面三角化只能修复兼容性，不能把当前实现变成原生 OpenCSG/F5 快速预览。**

用户提供的日志由本扩展生成，说明当前模型的 CSG 处理遇到未实现的多边形面三角化，然后**整棵模型**改走 OpenSCAD STL 导出。它不说明 OpenSCAD 不支持此模型，也不说明 CLI 没有生成 CSG。

更关键的是，当前实现是 **CSG 文本导出 → Manifold 几何布尔求值 → 三角网格 → Three.js**。已实现部分 CSG 的交互网格预览，但**尚未实现与原生 F5 等价的 OpenCSG 图像空间快速预览**。即使不触发回退，仍会计算布尔结果的边界网格；工作线程解决的是主线程阻塞和取消，不能据此保证 F5 的性能特征。

这两个结论分别来自下面的代码链路和真实 CLI 对照实验。

## 日志从哪里来

- [evaluate.mts](../src/core/csg/evaluate.mts) 的 `polyhedron` 分支只接受 `face.length === 3`；其他长度直接抛出 `Unsupported CSG operation: non-triangular polyhedron face`。因此四边形和一般多边形面全部触发该限制。当前代码没有尝试三角化。
- [ScadRenderer.ts](../src/features/preview/extension/services/ScadRenderer.ts) 捕获 `Unsupported CSG operation:` 前缀，打印用户看到的后半句，将格式从 `CSG` 改为 `STL`，再次调用 `ScadClient.render`，保留 `$preview: true`。
- [ScadModelRenderer.ts](../src/features/markdown/ScadModelRenderer.ts) 为 Markdown 实现了同类整模型回退，并在结果的 `note` 中记录原因。
- [ScadClient.ts](../src/features/preview/extension/services/ScadClient.ts) 的 CSG 分支执行 `--export-format csg -D '$preview=true'`；回退执行的是 `--export-format stl`，不是 PNG/OpenCSG 渲染。

日志中 “native mesh evaluator” 仅表示选中的 OpenSCAD 可执行文件生成网格；具体使用何种原生几何后端取决于该运行时，不能据此断言是 CGAL 或 Manifold。

## 原生 OpenSCAD 与当前路径的区别

| 路径 | 实际产物/计算 | 当前状态 |
| --- | --- | --- |
| CLI 导出 `.csg` | 展开后的节点/参数文本，保留布尔树与 polyhedron 多边形面 | 已接入 |
| 当前 CSG 模式 | Manifold 对树做几何布尔求值，再返回最终三角网格 | 已部分接入，有节点/参数限制 |
| 当前回退 | 再次调用 CLI 导出整个模型的 STL | 已接入，发生了两段工作 |
| 原生 OpenCSG/F5 | 图像空间算法用深度/模板缓冲合成 CSG 可见表面，不要求先计算最终布尔边界 | 当前未接入 |

OpenSCAD 的 CLI 源码把 `.csg` 输出放在独立分支，使用 `tree.getString`；PNG/OpenCSG 使用 `prepare_preview`，STL 等几何输出则进入 `GeometryEvaluator`。这证明 CSG 导出、原生预览和网格导出是不同阶段。[OpenSCAD CLI 源码](https://github.com/openscad/openscad/blob/master/src/openscad.cc)

`--preview` 是图像导出选项；它不会把 `-o model.stl` 变成一个可交互 OpenCSG 窗口。CSG 导出默认的 `$preview` 也不等价于进入 F5，覆盖 `$preview=true` 只是控制模型脚本的预览条件分支。[OpenSCAD CLI 手册](https://github.com/openscad/openscad/blob/master/doc/openscad.1.in)、[OpenSCAD 语言手册](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html)

OpenCSG 官方说明其核心是 OpenGL 图像空间 CSG，不显式构造最终形体的几何边界。原生 F5 快速预览的关键在此，不在文件后缀是否为 `.csg`。[OpenCSG 官方说明](https://opencsg.org/)、[OpenSCAD 快捷键定义](https://github.com/openscad/openscad/wiki/Keyboard-Shortcuts)

本地 [evaluate.mts](../src/core/csg/evaluate.mts) 的 `combine` 调用 Manifold 的 `union`/`difference`/`intersection`，末尾调用 `getMesh`；[Stage.ts](../src/features/preview/webview/preview/Stage.ts) 的 CSG 分支解析 `CsgScene.meshes`，创建 `BufferGeometry` 和普通材质。传给 Webview 的已是几何结果，原始布尔树没有交给 GPU。

## 为什么合法 CSG 会有非三角形面

OpenSCAD 的 `PolyhedronNode::toString()` 将 `faces` 原样逐项输出，不会在 CSG 文本导出时强制拆成三角形。其 `createGeometry()` 接受多边形索引并单独记录是否全为三角形。[OpenSCAD polyhedron 源码](https://github.com/openscad/openscad/blob/master/src/core/primitives.cc)

Manifold 的 Mesh 接口却要求 `triVerts` 是每三个顶点索引组成的三角形，外侧为逆时针方向；插件正是在适配这个接口时缺少多边形面三角化。Manifold 自身是面向三角流形网格的实体布尔库。[Manifold Mesh API](https://manifoldcad.org/docs/jsapi/classes/manifold.Mesh.html)、[Manifold 实体 API](https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html)

## 最小实验

使用本机已选运行时 **OpenSCAD 2026.10.27**，取一个边长 20 的合法立方体：

```openscad
polyhedron(
  points = [[0,0,0],[20,0,0],[20,20,0],[0,20,0],
            [0,0,20],[20,0,20],[20,20,20],[0,20,20]],
  faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],
           [1,5,6,2],[2,6,7,3],[3,7,4,0]],
  convexity = 10
);
```

分别通过 `--export-format csg -D '$preview=true'`、当前 `dist/csg-worker.mjs` 和 `--export-format stl` 检查。再将每个四边面拆成两个三角面，保持模型相同：

| 输入 | CLI CSG | 当前 worker | 原生 STL |
| --- | --- | --- | --- |
| 6 个四边面 | 成功，保留 6 个四边面 | 返回所述 non-triangular 错误 | 成功，1497 bytes |
| 等价的 12 个三角面 | 成功，保留三角面 | 成功，`meshes.length === 1` | 成功，1497 bytes |

实验不使用用户原文件，因此证明的是该错误的充分触发条件，不能确认用户模型是否还有其他不支持节点。实验脚本位于本次会话的 `/private/tmp/csg-polyhedron-repro.mjs`，脚本生成的输入和临时导出在完成后清理。

## 建议与实现边界

1. **修复具体兼容缺口**：为 polyhedron 面增加三角化，校验顶点索引、退化面、面平面性和绕序。不能把所有面都无条件按顶点扇形拆分；凹多边形需要可靠的平面投影与三角化。可评估已有 Manifold `triangulate` API，它支持多边形/洞并区分凸形优化与凹形 ear-clipping；3D 面投影及非平面面策略仍由适配层负责。[Manifold triangulate API](https://manifoldcad.org/docs/jsapi/functions/manifold.triangulate.html)
2. **不要把修补三角化称为实现原生快速预览**：它只减少整模型 STL 回退；当前成功路径依然执行 Manifold 实体布尔求值。还存在 text、import、扭转挤出等主动回退条件，见 evaluator 实际分支。
3. **让实际路径可见并测量**：区分 CSG 展开耗时、工作线程求值耗时、CLI 网格回退耗时和首帧耗时；回退时明确显示“当前使用 CLI STL”，避免按钮保持 CSG 状态却让用户误认为仍在原生快速路径。性能需要按具体模型测试，不能仅凭换后端保证提升。
4. **若目标是 F5 的核心性能机制**：需单独实现/接入图像空间 CSG 后端，保留原始布尔树及操作数网格供 GPU 合成，并处理深度、透明度、复杂度和交互工具集成。OpenSCAD 官方已有 WebGL 图像空间 CSG 的设计研究，可作为技术背景，但该页面是 2023 年设计笔记，不能把其中的浏览器限制当作 2026 年现状。[OpenSCAD WebGL CSG 设计研究](https://github.com/openscad/openscad/wiki/WebGL-CSG-Implementation)

修复多边形面与实现 F5 等价预览是两个不同工作项。当前日志揭示了前者，同时暴露了此前对“快速预览”能力描述过宽的问题。
