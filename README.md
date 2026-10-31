# SCAD AI IDE

> 面向 OpenSCAD 的集成开发环境，让代码与模型在同一个工作区中连接起来。

## 插件简介

**SCAD AI IDE** 是一款 VS Code 扩展，以 **IDE 体验**为核心，整合 OpenSCAD 代码编辑、三维预览、参数调试和运行时管理，覆盖从编写模型到检查、导出的日常工作。

**AI 能力增强**是第二个产品方向，计划围绕 OpenSCAD 开发工作流提供辅助能力，**目前尚未实现**。

```text
编写代码 → 预览模型 → 调整参数 → 测量与检查 → 导出 / 切片
```

**快速体验**：打开 `.scad` 文件 → 在 **Runtime** 中选择或安装 OpenSCAD → 点击 **Open as Preview**。

| 切换源码 / 预览 | 快捷键                 |
| :-------------- | :--------------------- |
| macOS           | `Cmd` + `Shift` + `V`  |
| Windows / Linux | `Ctrl` + `Shift` + `V` |

> [!TIP]
> 已集成 OpenSCAD 语言支持与预览，无需另装独立扩展。预览和导出需要可用的 OpenSCAD 运行时及可信工作区；新建文件请先保存为 `.scad`。

## 功能概述

### 🛠️ IDE 与建模工具

| 功能              | 能力                                                                                                 |
| :---------------- | :--------------------------------------------------------------------------------------------------- |
| **代码编辑**      | 语法高亮、代码片段、括号匹配、自动缩进、注释与代码折叠                                               |
| **代码智能**      | 补全、悬停说明、定义跳转、重命名、大纲、错误诊断与格式化                                             |
| **三维预览**      | 自动更新模型，旋转 / 平移 / 缩放，26 方向视角切换，透视 / 正交投影                                   |
| **显示与场景**    | 实体 / X-Ray / 线框，网格、打印平台、光照、阴影与场景树                                              |
| **参数调试**      | Customizer 与预览面板双向同步，支持滑块、数值、枚举、布尔、文本、向量与注释提示                      |
| **参数预设**      | 保存、应用、更新与删除参数方案，兼容 OpenSCAD `.json` 预设文件                                       |
| **测量与剖切**    | 顶点 / 边 / 面吸附测量，查看坐标与距离，通过剖切平面检查内部结构                                     |
| **导出与切片**    | 导出 **STL / 3MF**，将当前参数下的模型发送到切片软件                                                 |
| **Markdown 预览** | 自动渲染 `openscad` / `scad` 代码块，通过跟随 VS Code 主题的 Preview / Source Tab 切换交互模型与源码 |

Markdown 中使用下列任一种代码块，打开 VS Code 内置 Markdown 预览即可旋转、缩放和测量模型：

````markdown
```openscad
cube(20);
```

```scad
cube(20);
```
````

代码块默认显示 Preview，可切换到 Source 查看源码，支持方向键、Home / End 切换 Tab；每个代码块独立切换，渲染完成后的自动刷新会保留所选 Tab。预览默认采用 **4:3** 比例，最大 **800 × 600**，在窄窗口中按比例缩小。

Markdown 源码编辑器和预览中的 Source Tab 均支持 `openscad` / `scad`（大小写不敏感）的语法高亮，复用扩展的 OpenSCAD 语法规则；高亮不依赖 CLI，也可在关闭模型预览时使用。
Source Tab 同时读取当前 VS Code 主题及 `editor.tokenColorCustomizations`，按完整语法 scope 匹配颜色、粗体、斜体和下划线；切换主题或修改自定义规则后自动更新。

Markdown 的 Preview 直接嵌入交互视口。标准路径由选中的 OpenSCAD CLI 导出 **STL / 3MF**；快速路径导出 **CSG 树**（`$preview=true`），宿主 Node Worker 准备操作数、局部几何和布尔程序，GPU 沿像素射线求结果边界。普通三维布尔不在快速首帧生成最终边界网格。两条路径共享 Three.js **WebGPURenderer**，自动选择 WebGPU 或 WebGL 2。

只有进入视口且选中 Preview 的代码块才创建交互实例，同时最多保留两个；离开视口或切到 Source 后暂停绘制，2 秒后释放 GPU 资源，再次进入时恢复视角。CLI/CSG 编译结果按代码块缓存，相对资源以 Markdown 文件所在目录为基准。浏览器不执行 WASM、不读取本地模型文件。快速模式失败会显示原因，编辑器保留最后有效帧，不再暗中导出 STL。通过 `scad-ai-ide.markdown.preview.enabled` 可关闭 Markdown 预览。

Markdown 默认使用标准网格，可用 `scad-ai-ide.markdown.preview.renderMode: "preview"` 改为快速模式。使用编辑器标题栏或命令 **Open Markdown Preview with 3D Tools** 可打开扩展管理的 Markdown 预览，保留内置预览。该入口支持宿主按需生成精确拓扑，包括剖切后的封口、线框和顶点/边工具；内置预览继续提供兼容入口。

预览左下角分别显示求值路径、实际图形后端和首帧耗时。CSG 首帧得到浏览器确认后才启用连续拖动更新。完整实现边界、兼容覆盖和未完成的验收项见 [双路径预览说明](docs/csg-preview.md)。

`.scad` 预览顶部在透视/正交按钮右侧提供 **CSG preview / Full mesh render** 切换，两种模式均可交互并保留相机位置。默认完整网格，可用 `scad-ai-ide.preview.renderMode: "preview"` 改为 CSG。`.csg` 文件支持相同的预览入口，默认直接读取 CSG，无需额外 CLI 求网格。STL / 3MF 导出始终计算完整几何。

<details>
<summary><strong>参数调整如何工作？</strong></summary>

面板中的修改会更新模型，**不会改写源码**；各文件分别保留当前会话中的调整，需要长期复用时可保存为预设。

Customizer 侧栏使用自定义 HTML/CSS，跟随 VS Code 主题，采用原生 TreeView 的紧凑行高、分组折叠和键盘导航。支持第一个 `{` 之前的数字、字符串、布尔和 1–4 维数值向量，遵循 [OpenSCAD Customizer 官方规范](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer)。例如：

```scad
/* [尺寸] */
// 模型宽度，单位 mm；悬停参数名或控件可查看说明
width = 40; // [10:5:100]
height = 20; // [100]
wall = 2.5; // .5
size = [10, 20, 30]; // [0:5:100]
label = "Model"; // 20
shape = "round"; // [round:圆形, square:方形]
hollow = true;

cube([width, width, height]);
```

支持 `[max]`、`[min:max]`、`[min:step:max]` 滑块，带标签的数字/字符串下拉框、复选框、数值微调框、文本长度提示及向量微调框。参数说明、范围、步长和默认值以易读的悬停提示显示。滑块仅显示滑动条，向量输入带 X/Y/Z/W 标识。修改值后可单独重置，也可重置全部参数。

`/* [组名] */` 创建折叠分组；无分组参数放在 Parameters；`[Global]` 参数始终显示在根级；`[Hidden]` 参数隐藏。支持多行向量和无分号的 include/use 指令；表达式、库文件中的参数及首个 `{` 之后的变量不会暴露。支持 `/* [Tab] [Name] */` 多段分组名称、Unicode 参数名以及数字/字符串混合枚举；后续重复赋值会替换或移除原有控件。向量也可与预览、JSON 预设及 `-D` 渲染参数同步。

面板参数修改自动更新 Preview。CSG 画布确认首帧后，滑块可在拖动中持续提交参数；标准网格在松手时提交最终值。调度保留一个运行任务与一个最新等待值，浏览器和宿主拒绝过期结果。相机移动不调用 CLI。静止 CSG 视角跳过重复绘制；复杂模型的性能仍受操作数数量、三角形数量和设备能力影响。模型名显示在原生 Customizer 标题描述中，全局重置、全部折叠/展开放在原生视图工具栏。预设文件名与折叠标题合并，右侧保留打开、保存和更多三个按钮，下方为预设下拉框；新建、删除和导出位于更多菜单。初始不自动打开同名 JSON，也不显示推测的文件名；只有明确打开文件，或新建预设并选择保存位置后，标题才显示实际文件名。保存使用 OpenSCAD 的 `fileFormatVersion: "1"` / `parameterSets` 格式；保留文件中其他预设、隐藏参数和额外字段。导入仅加载列表，选择预设后才应用；修改后下拉框标记 Unsaved。部分预设保留未指定的当前参数，选择 Design default 则恢复全部源码默认值。JSON 文件名和内部预设名都可自由命名；参数键名需要对应源码中的变量名。切换预设会立即重绘 Preview；当前预设文件发生外部修改时，未手动调整的模型也会更新，未保存的手动调整则保留。切换文件分别保留当前会话中的预设状态。

</details>

### ⚙️ 环境与版本管理

| 功能            | 能力                                                                      |
| :-------------- | :------------------------------------------------------------------------ |
| **自动发现**    | 在 Windows、macOS、Linux 中查找常见位置的 OpenSCAD 安装，也可手动指定程序 |
| **在线安装**    | 筛选适合当前系统与架构的版本，提供推荐安装、下载进度和重装入口            |
| **离线安装**    | 导入 `.zip` / `.tar.gz` CLI 构建包                                        |
| **多版本共存**  | 在 Runtime 页面或状态栏切换版本，删除扩展托管的安装                       |
| **GitHub 连接** | 通过 VS Code 授权访问 GitHub，提高版本列表与下载请求额度，无需粘贴 Token  |
| **远程开发**    | 支持 SSH、WSL、Dev Container，运行时与模型计算位于对应主机或容器          |

<details>
<summary><strong>常用入口与设置</strong></summary>

- **Quick Access → Runtime**：查看当前环境、管理本地版本、下载或导入安装包。
- **Quick Access → More → GitHub API**：连接 GitHub 账号。
- **预览 → Parameters → Export / Print**：导出模型或发送到切片软件。
- **预览底部日志**：查看模型编译输出。

| 设置                                     | 用途                           |
| :--------------------------------------- | :----------------------------- |
| `scad-ai-ide.openscadPath`               | 指定 OpenSCAD 程序路径         |
| `scad-ai-ide.languageServer.searchPaths` | 添加语言服务使用的库目录       |
| `scad-ai-ide.preview.format`             | 选择 STL 或支持颜色的 3MF 预览 |
| `scad-ai-ide.preview.slicerExecutable`   | 指定切片软件路径               |

3MF 需要所选 OpenSCAD 版本支持。远程开发时，程序和切片软件路径均指向远程环境。

</details>

### ✨ AI 增强与扩展方向

| 方向                                               | 当前状态              |
| :------------------------------------------------- | :-------------------- |
| **AI**：Skills、MCP、Agent Tools、AI Provider 管理 | ⏳ 预留入口，尚未实现 |
| **Bricks**：可复用建模积木管理                     | ⏳ 预留入口，尚未实现 |
| **Libraries**：OpenSCAD 库与依赖管理               | ⏳ 预留入口，尚未实现 |

> [!NOTE]
> 当前已提供的能力以 IDE 和建模工具为主，尚不提供 AI 代码生成或自动建模。
