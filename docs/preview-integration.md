# Preview 集成说明

选择源码迁移并适配宿主，而非重写视口。来源为子模块 `sources/vscode-openscad-preview` 当前工作树（HEAD `4bbb851853bbf1780a568b70e06824a365c7dbe2`），包括其视角立方体、导航和打印平台改动；没有修改来源仓库。其 Three.js/Lit 组件、rig、工具、shader、打印平台 STL 和消息协议迁入 `src/features/preview/`。这是独立可构建的源码快照，构建、发布和运行不读取 Preview 子模块，也不安装该扩展。

## 宿主边界

- `registerPreview.ts` 在现有扩展入口注册 CustomTextEditorProvider；命令和 viewType 使用 `scad-ai-ide` 前缀，语言 ID 使用已有 `openscad`。沿用 VS Code 内置 Markdown 使用的 `reopenActiveEditorWith` 标签替换方式，升级 VS Code 时应重跑宿主测试。
- `ScadClient` 使用统一 Runtime 的 executable/argsPrefix，检查工作区信任，不自行探测 OpenSCAD。源码未保存时走 stdin，cwd 为源码目录，字符串通过 JSON 字面量编码后作为独立 `-D` 参数传递，不使用 shell。
- STL 网格预览（含 Markdown）显式使用 CLI `--export-format binstl`，以 Binary STL 作为中间格式；临时文件扩展名和前端格式标识仍为 `stl`，原始二进制经 Base64 传给 STLLoader。同一 CLI 路径的 STL 导出也使用二进制格式。
- 每文件一个会话；新的预览取消旧预览，导出有独立任务标识，不取消预览。会话关闭取消等待中的/运行中的预览，释放 watcher 和事件；临时渲染目录在成功、失败、取消后回收。
- 文件监视使用 VS Code FileSystemWatcher，无需 chokidar。配置与 Runtime 变化刷新已打开的预览。3MF 和 lazy-union 能力由选择的 OpenSCAD 提供，默认 STL 不假定安装 nightly。
- `ScadParser` 是既有 `parseCustomizer` 的 UI schema 适配器；原生侧栏与预览共用 `CustomizerService` 每文件覆盖值，通过订阅同步。只给 CLI 传显式覆盖值，表达式继续由 OpenSCAD 计算。Customizer 侧栏通过独立的预设文件控制器支持显式打开 JSON、新建/保存/删除/切换、导入导出；未选择文件时不绑定同名 JSON，新建首个预设需选择保存位置。模型名使用 `WebviewView.description`，全局动作通过 `view/title` 命令和折叠状态 context keys 管理；预设标题只保留打开、保存、更多三个动作。预设序列化与校验集中在 `core/customizer/CustomizerPresets.ts`。参数修改始终自动更新 Preview；显式预设选择通过 `preset` 变更原因触发对应 `ScadSession` 的优先重绘，并抑制共享值的重复回写。场景与测量交互保留在迁入模块中。

## 空模型与预览入口

SCAD 会话支持 `preview`（独立 Preview Exporter 导出 `.csgp`，GPU 图像空间 Boolean）和 `render`（普通 CLI 完整 STL/3MF 网格）。模式由 `scad-ai-ide.preview.renderMode` 控制，默认完整网格；顶部快速模式切换入口当前隐藏，内部模式切换仍保留 Stage 和相机。快速模式使用 `$preview=true`、未保存文本、参数覆盖、原文件 cwd 和依赖 watcher；不调用旧 CSG Parser、Manifold 快速求值或最终网格物化。算法、计时和限制见 [当前架构](preview-exporter-architecture.md)。

快速模式提供拾取和表面点测量；精确边/顶点测量与投影阴影使用 Full Render。裁剪、线框和 XRay 入口继续隐藏。错误保留上一张有效画面，不静默回退其他后端；macOS ARM64 以外的平台明确报告 Exporter 不可用。

Markdown 使用同一套 Lit App / Three.js Stage，直接挂载于内置 Markdown DOM，保持严格 CSP，不额外允许 iframe、Worker、网络连接或浏览器 WASM。宿主通过同步 markdown-it 缓存队列异步生成 CSG/网格数据；`scad-ai-ide.markdown.preview.renderMode` 控制该路径。每块有独立 Preview/Source Tab，最大 800 × 600、4:3。只有进入视口且选中 Preview 的块才挂载，同时最多两个实例；不可见时立即暂停 rAF，2 秒后释放 Stage/GPU 资源，再进入时恢复场景和相机。Markdown 刷新、关闭和切换 Tab 均处理实例清理。修改配置取消旧任务并清除缓存，临时文件在成功、错误和取消后清理。

所有 SCAD 文件保留预览按钮和快捷键入口。空文件、纯注释和只有变量赋值的配置文件进入预览后，跳过 CLI，在视口中央持续显示一行英文 `This file has no geometry to preview.`，无错误通知、加载动画或关闭按钮。检测使用当前文档（包括未保存的修改）并采用保守策略，`include`、`use`、模块/函数定义和其他不确定语法仍允许进入，由 OpenSCAD 执行结果判断；不会只按文件名或内置几何关键字筛选。

通过 Open With 直接打开配置文件也会跳过 CLI，在预览内显示无模型提示。条件分支、未调用的模块、布尔运算等导致 OpenSCAD 输出 `Current top level object is empty.` 时，同样作为无模型状态处理，停止加载并清除上一轮模型；伴随 `ERROR:` 或解析错误时仍保留真实错误。文件修改和参数调整会重新判断与渲染。

## 滑块与连续参数更新

Customizer 的 range 控件仅在宿主确认当前文件 CSG 后端成功时于 `input` 提交有效值；普通网格、首次确认前及错误状态只在 `change` 松手时提交最终值。消息显式区分 input/commit，宿主与 Session 双重检查资格，避免陈旧 UI 状态绕过限制。拖动期间忽略旧状态对滑块值的回写，防止滑块倒退。显式预设选择采用优先重绘。

实际后端经 `PreviewBackend`、Session 事件和 Webview 消息传递，与请求的 mode 分开，用于连续参数资格检查和回归测试。视口只显示实际加载、错误或工具提示；后端详情卡、完整阶段表和原始 JSON 按钮当前未挂载。Markdown 模型载荷仍携带后端元数据。

参数变化使用 `ScadRenderer.renderLatest`：最多一个运行任务及一个等待的最新参数，允许已运行任务完成并显示中间结果，再开始最新值。源码、预览模式或显式刷新使用优先 `render`，清除等待的参数任务并取消旧代；关闭会话丢弃等待工作。后端未就绪时只接收最终提交；未知或普通后端拒绝连续请求，最终提交去重但不能因先前已同步参数而丢失。旧参数错误在存在较新请求时不打断更新。Preview 仅在格式或数据变化时更新网格，loading/mode 通知不重复解码和上传旧网格。

参数变化需要重新调用 Exporter；相机变化只执行 Goldfeather GPU 绘制，不重新请求几何。`fastPreview.test.ts` 覆盖合并、持续完成、模式切换、错误及释放，Customizer 浏览器回归使用鼠标按住拖动验证松手前宿主已收到中间值。

## 构建与发布

扩展宿主与浏览器分别使用 `tsconfig.json` 和 `tsconfig.webview.json`。`esbuild.js` 输出 `dist/extension.js`、`dist/preview.js`、`dist/markdown-preview.js`、`dist/mesh-topology-worker.mjs`，并复制 `dist/manifold.wasm`，将 shader 和 STL 嵌入浏览器 bundle，并复制 codicon CSS/字体到 `dist/codicons/`。VSIX 不依赖运行时的 node_modules 或 src 目录。Webview 仅允许 dist 本地资源，脚本使用 nonce CSP，字体不请求外部 CDN。

原有语言高亮、snippets、LSP 不重复迁入。

## 验证

`npm test` 覆盖核心、语言与视口回归；`npm run package` 检查宿主/浏览器类型、ESLint 及生产 bundle。`test:preview-editor` 使用实际 VS Code API 和假 CLI 检查标签替换、dirty 文档保留、Open With、启动前缀、stdin/cwd、双向参数同步、JSON 预设与导出。真实几何、显卡渲染和本机切片软件仍需对应运行时与设备验收。

可设置 `SCAD_OPENSCAD_EXECUTABLE` 为支持 3MF 的真实 OpenSCAD 路径，随 `test:preview-editor` 额外执行 STL/3MF 导出烟测；默认测试仍使用假 CLI，无需安装 OpenSCAD。

真实运行时验证独立 Exporter 的原始 Products 与普通 CLI 网格导出。未编译 3MF 导出能力的 CLI 可通过 `SCAD_OPENSCAD_CSG_EXECUTABLE` 验收 STL 与 CSG。`npm run test:fast-preview` 验证 CSG 会话和内部模式切换，`npm run test:markdown` 检查严格 CSP 下的交互嵌入、Tab、尺寸、主题及视口暂停/恢复。

Markdown 白屏回归额外使用 `SCAD_VSCODE_EXECUTABLE=... npm run test:markdown-host`，通过 CDP 访问真实 VS Code Markdown Webview，检查缓存 CSG 的首帧、连续绘制、宿主刷新和 Tab 切换；HTML 生成成功不能替代实际画布验收。初始化同时监听正文 DOM 的异步替换，避免首次替换没有 `updateContent` 事件时漏挂载。当前快速预览的 `.csgp` → Goldfeather 深度/模板 → 着色合并路径见 [架构说明](preview-exporter-architecture.md)。

## 手动双向同步

本插件根目录提供 `npm run preview:sync -- to-ide` 与 `to-preview`，分别生成外部到内部、内部到外部的审阅计划；加 `--apply` 可在无冲突时直接应用。同步使用两份独立基线和三方合并，保留宿主适配，不改变本扩展独立构建、独立运行的方式。同步脚本及 `.preview-sync/` 基线随本插件维护，不依赖 Builder；默认使用 Preview 子模块，可通过 `PREVIEW_SYNC_PREVIEW_ROOT` 指定其他路径。完整流程及冲突解决见 [同步说明](../scripts/preview-sync/README.md)。同步不拉取上游、不自动执行、不提交 Git。初始基线已建立，不需要重新 init。

## ViewCube 预设视角

面、边、顶角对应 26 个预设方向（6 个面、12 条边、8 个顶角）。边定位到相邻两个面的角平分方向：水平边为对应正面/侧面的 45° 俯仰视角，垂直边为水平面内相邻两面之间的 45° 视角；顶角使用三轴等分的等轴测方向。所有区域共用 CameraRig 的方向定位和 Z-up 校正，不再将目标投影到当前屏幕的单轴轨道。切换保留观察中心和距离，可打断未完成的动画，重复点击保持稳定，透视与正交相机同步。

`cubeNavigation.test.ts` 使用实际 CameraRig、TrackballControls 和相机动画循环（仅提供 DOM 事件表面与可控时钟），检查所有顶角到边的准确方向、全部预设之间的切换、滚转恢复以及动画中途改选。

## 初始视角、模型颜色与光照

没有已保存相机的文件首次进入预览时，自动取景为 Top–Left–Front 顶角（方向 `[-1,-1,1]`）；取景按该方向的投影尺寸计算，支持高瘦模型和竖向窗口。已有相机状态继续恢复，右上角 Reset 保留 Top 取景。

默认模型材质使用从主题前景/背景导出的中性灰白色，并保持对比度。默认开启柔和阴影，降低环境光、强化来自左前上方的主光，以弱填充光补足暗部。主方向光的阴影相机根据模型包围盒适配，使用 2048 阴影贴图，避免默认小范围阴影丢失。

左侧测量工具组下方提供 Choose model color 按钮及原生颜色选择器；自选颜色即时应用并随场景快照保存，不改写 SCAD 源码或导出文件。Restore default model color 恢复主题默认色及 3MF 原有颜色。旧快照没有颜色字段时仍正常加载。

## 中性棚拍预览风格

Full Render 的模型外观参考 Apple RealityKit / macOS Preview 的中性产品预览风格，属于 Three.js 中的视觉近似，不复用 Apple 的渲染器或私有参数。默认模型在浅/深色主题均保持亮灰白底色，使用非金属、适度粗糙的表面；本地生成 RoomEnvironment，经 PMREM 提供宽高光和柔和暗部填充，配合 NeutralToneMapping 控制高光，不下载外部 HDR 资源。环境贴图对齐 OpenSCAD 的 Z-up，并随 Stage 释放 GPU 资源。

背景、网格与纯色打印板继续由 VS Code 主题变量驱动，打印板保持无光照、无阴影的平面显示。模型选色及 3MF 原有材质保留；不再用文字的 3:1 对比度要求强制把浅色主题的模型压成深灰。

## STL / 3MF 文件与交互速率

SCAD 保留可编辑的 CustomTextEditorProvider；STL 与 3MF 使用独立的 CustomReadonlyEditorProvider，直接通过工作区文件服务传递原始二进制数据，不创建 TextDocument，不依赖 OpenSCAD Runtime。两种预览复用同一 Webview、相机、主题、测量、颜色与场景保存逻辑。编辑器标题入口、Open With、命令与 Cmd/Ctrl+Shift+V 都覆盖三种扩展名（不区分大小写），切换替换当前标签；原始文件保留原字节。磁盘变更会刷新模型，关闭文件时清理 watcher 和未完成的读取。原生模型的导出/发送切片器保留其原始格式，不暗中转换。

缩放与原生触摸平移的 Rate 均设为 1；中键、右键及修饰键拖动统一使用屏幕像素 1:1 平移。颜色重置使用与其他工具一致的 16px SVG 图标。打印板从主题变量取色，在 Oklab 中对浅色主题反转亮度方向，再压缩到 L=0.40–0.46 的深灰范围（中性色约 #48–#58）；保留低饱和度主题色调，网格线使用高 0.13 的感知亮度；其余视口继续遵循当前主题。

宿主回归覆盖 ASCII STL、二进制 STL、3MF 的反复同标签切换、Open With、文件字节保持和不触发 CLI；SCAD 用例覆盖未保存文档、参数/预设与导出。执行方式见 [开发说明](../CONTRIBUTING.md)。
