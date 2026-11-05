# 从 3D 预览跳转到 OpenSCAD 源码的可行性研究

日期：2026-11-04。范围：当前插件的普通预览、内部图像空间预览，以及实验性零件着色附加数据。本次只研究，不实现跳转。

## 结论

**可实现，但当前数据不足以可靠地跳到具体源码片段。** 鼠标命中几何体已有基础设施；缺少的是“命中的实例/表面 → 本次求值的 OpenSCAD 节点 → 源文件位置与调用链”的对应关系。补一个右键菜单不能补回已经丢失的来源信息。

尤其需要区分两条渲染路径：当前普通 SCAD 预览默认是 `render`，消费 Full Render 的 STL/3MF；内部 `preview` 模式消费 Preview Exporter 的 CSG Products。后者更容易扩展实例来源映射，前者不能仅凭现有零件颜色就实现同等精度。[默认模式与会话](../src/features/preview/extension/core/ScadSession.ts)、[CLI 路径](../src/features/preview/extension/services/ScadClient.ts)、[模型表示](../src/features/preview/webview/preview/models/ModelRepresentation.ts)

推荐先扩展原生 Exporter 的来源协议，再实现版本化的拾取与源码跳转。普通 Full Render 必须另行解决最终网格与来源的对应；不应把包围盒或颜色推断宣传为精确定位。

## 现有数据能做什么

| 数据/组件 | 已有能力 | 不能由它直接得到的内容 |
| --- | --- | --- |
| `ModelRepresentation.pick()` | 对标准网格做射线拾取，或委托 Goldfeather 拾取 | `.scad` 文件、行列、模块调用位置 |
| `tracePreview()` / Goldfeather | 按 CSG Products 判定有效表面，命中包含 operand ID；支持减项形成的表面 | 源码节点及调用链映射 |
| `PreparedScene.instances` | 网格引用、变换矩阵、颜色、convexity | 源文件 URI、行列、AST 节点 ID |
| STL 零件着色 | 按相同坐标焊接顶点，划分连通壳体 | 壳体对应哪个模块调用；融合后壳体的多个来源 |
| 附加 `.csg` / `CsgPartHint` | 展开后的几何树、部分变换/包围盒/显式颜色；hint ID 为解析树路径 | 原 `.scad` 的文件位置与调用栈 |
| CSG 包围盒着色辅助 | 在点所属包围盒中优先匹配较小者，为网格三角形分配颜色 | 精确几何归属；重叠、布尔切割与重复实例的可靠源码归属 |

证据：[模型拾取](../src/features/preview/webview/preview/models/ModelRepresentation.ts)、[Products 查询](../src/core/preview/query.ts)、[Goldfeather 拾取](../src/features/preview/webview/preview/csg/GoldfeatherRenderer.ts)、[数据结构](../src/core/preview/types.ts)、[STL 连通壳体着色](../src/features/preview/webview/preview/managers/PartColors.ts)、[CSG hints](../src/core/preview/csgParts.ts)、[包围盒匹配](../src/features/preview/webview/preview/managers/CsgPartColors.ts)。

Goldfeather 当前把 `hit.operand` 转成 `proxies[hit.operand]` 后返回 Three.js Intersection；代理只设置了 `userData.csg = true`，并没有现成的源码 ID。需要显式把 operand/instance ID 带到新的拾取结果中，不能假设现有 Intersection 已携带来源。

`PreparedScene.source` 的值是 `OpenSCAD CSGTreeEvaluator/CSGTreeNormalizer/CSGProducts`，它是数据生产管线标识，**不是源文件路径**。内部 `provenance.source` 也不能用作跳转地址。[协议类型](../src/core/preview/types.ts)、[解码与转换](../src/core/preview/read.ts)

## 实际导出验证

本次使用重复模块调用和布尔差集进行导出：

```scad
module peg(){ cube([4,4,6]); }
difference(){
  union(){ peg(); translate([8,0,0]) peg(); }
  translate([2,2,-1]) cylinder(h=8,r=1,$fn=16);
}
```

已运行真实普通 CLI 与已安装的 Preview Exporter。两个进程均成功退出：

- `.csg` 得到展开的 `group`、`multmatrix`、`cube`、`cylinder`；未保留原模块调用名称、原始文件行列或调用栈。
- `.csgp` 有三个实例；每个实例字段仅为 `mesh` / `matrix` / `color` / `convexity`，没有源码位置。
- 两个相同模块的调用虽有不同位置，不能凭网格或颜色反推是哪一行 `peg()`。

本机可复核的原始记录：[模型](../.build/source-navigation-probe/model.scad)、[CSG](../.build/source-navigation-probe/model.csg)、[导出字段及退出码](../.build/source-navigation-probe/result.json)。这些文件在忽略目录中，不作为提交的测试资产；上面保留了可重建的最小输入。

## OpenSCAD 本身已有可参考实现

原生 OpenSCAD GUI 的 `MainWindow::rightClick()` 已采用如下链路：

1. `pickObject()` 得到对象节点索引。
2. `rootNode->getNodeByID(index, path)` 找到节点及祖先路径。
3. 读取 `step->modinst->location()`。
4. 将调用路径作为右键菜单，展示源码文件和行号，并为有来源的节点提供编辑器定位/高亮。

不是所有节点都有 source reference，原生菜单也保留“无源码引用”的情况，不强行制造位置。可参考当前 Exporter 所标记的上游基础提交中的 [MainWindow.cc](https://github.com/peterisdev42/openscad/blob/9ba0cee7c94785fac0ca8dfe040b965a12a25ed1/src/gui/MainWindow.cc#L2152)。

上游 `ASTNode::Location` 有文件路径与起止行列，`AbstractNode` 有本次求值树内的唯一索引及 `modinst`，`CSGTreeEvaluator` 创建 `CSGLeaf` 时传入 `node.index()`。这证明求值阶段有一条可利用的来源链路；**不等于当前 JSON Exporter 已输出了它**。[Location](https://github.com/peterisdev42/openscad/blob/9ba0cee7c94785fac0ca8dfe040b965a12a25ed1/src/core/AST.h)、[节点](https://github.com/peterisdev42/openscad/blob/9ba0cee7c94785fac0ca8dfe040b965a12a25ed1/src/core/node.h)、[CSGLeaf 构造](https://github.com/peterisdev42/openscad/blob/9ba0cee7c94785fac0ca8dfe040b965a12a25ed1/src/core/CSGTreeEvaluator.cc#L219)

证据边界：当前工作区 OpenSCAD 子模块为 `8e8df3dd...`，插件固定的 Exporter provenance 基础提交为 `9ba0cee7...`，二者不可混为一个版本。本次对固定基础提交使用本地 Git 对象检查，并以上述精确提交链接引用。独立 Exporter 的 Builder 补丁不是这些基础源码文件；本次没有宣称审阅到其完整导出实现。实际发布格式以真实导出结果和插件协议为准。[固定版本](../src/core/preview/types.ts)、[已有二进制实验记录](preview-exporter-experiment.md)

## 建议的实现边界

### 1. 原生来源协议

建议在原生求值/Exporter 层增加来源表，而不是在 TypeScript 中重新实现 OpenSCAD 求值：

- `sourceDocuments`：文档 ID、实际 URI/路径、渲染快照标识。
- `sourceNodes`：本次求值节点 ID、节点类型、定义/调用位置与祖先调用链。
- `instances[i].sourceNodeId`：几何实例指向求值节点；共享 mesh 的不同实例仍有不同来源。
- source range 使用起止行列，并明确索引起点、列单位、结束位置是否包含；必须测试中文与 emoji，而不是直接假定 OpenSCAD 列号等同 VS Code UTF-16 字符偏移。

插件协议目前严格核对 schema、tag、commit 和数据来源，转换过程也显式构造内部实例字段。新增映射需同时更新版本/能力协商、验证、转换、传输和缓存；只在原 JSON 塞字段会在后续转换中丢失。[读取转换](../src/core/preview/read.ts)、[内部验证](../src/core/preview/validate.ts)、[Exporter 安装与执行](../src/platform/previewExporter/runtime.ts)

特别需要处理主文档身份：实际生产调用把当前编辑器文本写入 STDIN，并用 `-` 作为输入；`sourcePath` 目前用于依赖环境，未作为 Exporter 的输入文件参数。必须为这个虚拟主文件提供原始 URI 与快照映射，不能把 `<stdin>` 或临时文件直接打开给用户。依赖库的实际来源路径需要保留。[生产调用](../src/platform/previewExporter/runtime.ts)

### 2. 拾取和右键交互

- 图像空间预览优先复用 `tracePreview()` 的有效 CSG 表面命中，保留 operand ID，不能只射线检测未裁剪代理网格；减法孔壁应能定位到形成该表面的减项，并允许选择外层模块调用。
- 当前右键拖动是平移操作，`pointerdown` 捕获并停止事件传播。必须区分静止右键与拖动，拖动结束不弹菜单，取消捕获、触屏及上下文菜单事件也需覆盖。[DirectPointerNavigation](../src/features/preview/webview/preview/rigs/DirectPointerNavigation.ts)
- 菜单默认提供“跳到当前模型中的模块调用”，并展开“几何原语/库内部调用”等调用链候选。用库构建的模型通常应先跳到用户的 `screw(...)`，而不是直接进入 BOSL 等依赖库的 `polyhedron()`。
- 标准网格命中可得到三角形/对象，但还需要下面的来源补全方案，不能拿连通壳体 ID 当源码节点 ID。

### 3. 普通 Full Render 是单独的一项工作

普通 SCAD 预览默认 Full Render，不能仅完成内部图像空间预览就认为用户日常预览已支持定位。[模式选择](../src/features/preview/extension/core/ScadSession.ts)

可选路线：

| 路线 | 能力与代价 |
| --- | --- |
| 原生最终网格导出面级 provenance | 最有希望覆盖 Full Render 的准确映射；需深入 Boolean 后端/三角化，研究面片拆分、合并与新生成面如何保留来源，当前代码没有该映射。 |
| 按需附加带来源的 CSG 拾取场景 | 比当前无来源 `.csg` 有效；可以做候选跳转，但必须验证与当前 Full Render 的几何一致性，不能默认等价。`$preview` 分支、`render()`、后端差异及求值时参数/依赖变化都可能不一致。 |
| 利用现有染色包围盒猜测 | 无需原生改造，但重复实例、重叠包围盒、孔洞、融合实体会误判。不推荐作为“跳到具体代码”的默认实现；若提供，只能明确标注近似候选。 |

`hull()`、`minkowski()`、`render()`、文字和导入网格等可能在一个求值节点生成整块几何。第一版可以准确跳到生成该几何的调用范围，不承诺总能细分回每个内部原语。独立打开的 STL/3MF 没有可信的 `.scad` 来源表时，应该禁用“跳到源码”，而不是搜索同名文件并猜行号。[现有网格着色](../src/features/preview/webview/preview/managers/PartColors.ts)、[当前格式和 CLI 分支](../src/features/preview/extension/services/ScadClient.ts)

### 4. 宿主跳转与过期保护

建议消息仅传 `{ type: 'revealSource', modelVersion, instanceId, sourceChoice }`；宿主从该模型对应的可信来源表解析 URI/range，使用 `openTextDocument`、`showTextDocument`、`Selection` / `revealRange`。不要信任 Webview 随意传入的 URI 或执行任意 command。需要兼容远程扩展宿主，不把本机路径拼成远程项目地址。[现有版本化消息](../src/features/preview/shared/types/WebviewToExtensionMessage.ts)、[宿主消息入口](../src/features/preview/extension/views/ScadWebviewPanel.ts)

源码表与命中必须绑定渲染版本、主文档快照、参数及依赖快照。渲染期间编辑文本导致行号改变时，第一版可拒绝旧映射并要求刷新模型；不能用旧模型的位置直接跳到新文档错误行。已有 `modelVersion` 和依赖指纹可作为基础，但当前没有源文档版本表。[ScadClient](../src/features/preview/extension/services/ScadClient.ts)、[预览缓存](../src/features/preview/extension/services/ScadRenderer.ts)

Markdown 中的生成 SCAD 还需保存 fenced block 起点、包装代码行偏移和 Markdown 文档快照，才能映射回 `.md` 的代码块；如果命中库内代码，则跳真实 `.scad`。内置 Markdown 与插件独立 Markdown Preview 的消息入口不同，应独立验收，不复用错误的宿主通道。[内置 Markdown](../src/features/markdown/registerMarkdown.ts)、[独立 Markdown](../src/features/markdown/OwnedMarkdownPreview.ts)、[SCAD 渲染包装](../src/features/markdown/ScadModelRenderer.ts)

## 建议实施顺序与验收

1. 先在 Builder/Exporter 做最小来源表实验，用重复模块调用、include/use 与减法孔壁证明 instance → 调用链可追踪。
2. 完成内部图像空间模式的右键静止拾取、调用链菜单、宿主跳转和过期拒绝，不依赖开启零件着色。
3. 单独验证普通 Full Render 的面级 provenance 或同步辅助拾取方案；没有几何一致性证据时只提供候选或禁用。
4. 最后覆盖 Markdown、独立 STL/3MF、库文件与远程项目。

最低测试集：同模块多次调用、for 循环同一调用行的不同实例、布尔减项孔壁、相交/重合实体、库内定义与用户调用、hull/render 生成几何、显式颜色重复、$preview 分支不同、中文列号、编辑后旧模型、参数切换、右键平移不弹菜单，以及无来源的外部网格不误跳。

**可行性判断：原生求值树来源链已有明确先例，图像空间拾取接口也已有基础，因此这是可推进的功能；默认 Full Render 的准确来源传递仍需原生层实验验证，不能把当前染色数据等同于现成的 source map。**
