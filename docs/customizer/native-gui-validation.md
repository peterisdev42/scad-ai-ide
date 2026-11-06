# 原生 Desktop 验收进度与待测矩阵

2026-11-09；不是全部通过报告。原生操作已经用户授权，不再重复请求辅助功能授权。用户于2026-11-10确认解锁。当前实际官方Desktop Qt矩阵12项已执行通过，独立核对了四次Preset标题、每步编辑器内容及偏好SHA；此前锁屏和控制器失败作为历史记录保留。

## 独立二进制与执行证据

从[官方snapshot目录](https://files.openscad.org/snapshots/)取得2026.11.06 macOS universal DMG，并与[官方SHA256](https://files.openscad.org/snapshots/OpenSCAD-2026.11.06.dmg.sha256)核对：`bf3c71ae90420b2cd08f09d4dfc42a5bd0d2481b23f895b671820fdabe7ce6ac`。只读挂载在仓库`.build`，没有安装到`/Applications`。

实际窗口状态栏显示git `a81e8630`；本地源码解析为`a81e863051c42ee04168683e945aca58d32d04a2`。与pinned `bcf45a22...`比较，`src/core/customizer`、`src/io/export_param.cc`、`src/gui/parameter`及ParameterWidget.cc/h没有差异。这仍不是完整pinned binary。

- Desktop二进制执行既有41例`.param`差分：**41 MATCH**，参考fixture没有漂移。[结果](native-desktop-cli.json)。这证明CLI导出范围，不能替代GUI。
- 已捕获过实际原生模型窗口，证明GUI启动及OpenGL视口；当时Customizer隐藏，**不算控件验收**。
- 历史锁屏阶段曾有SCStream -3811、目标无法激活和不完整AX树；这些失败未标PASS。2026-11-10用户解锁后已取得下述独立动态证据。

## 用户偏好保护与恢复

首次假设`CFFIXED_USER_HOME`可隔离Qt Native QSettings，实际失败：只有recentFileList被测试文件改变。启动前私有备份已保留；确认当前SHA仍与测试后结果一致、唯一改动键且包含本次fixture后，通过defaults恢复，逐值比较与原始偏好一致。plist重新序列化后的byte hash可以不同。恢复证据只记录hash/键名，不归档用户偏好内容：[恢复记录](evidence/native-gui-preference-recovery.json)。

之后改用macOS原生sandbox，禁止所有user-preference-write及真实home的直接文件写入。独立defaults写探针确实被拒绝，测试域未创建。后续截图测试原偏好SHA完全不变。后续动态测试也使用该sandbox；不能退回仅环境变量隔离。

## 动态检查矩阵（2026-11-10 实测）

官方Desktop2026.11.06/git a81e8630；没有称为完整pinned GUI或其他系统GUI。实际运行见 [12项结果](evidence/native-gui-2026-11-10/verified/dynamic-checks.json)，完整AX/echo及hash清单见 [证据索引](evidence/native-gui-2026-11-10/verified/manifest.json)。

| ID | 实际检查 | 当前结果 |
|---|---|---|
| NATIVE-UI-01 | 真实Customizer/Editor/Console，Dimensions描述与Hidden不显示 | PASS；检查控件树与真实窗口 |
| NATIVE-UI-02 | width默认120/effective上界120；实际鼠标减量箭头后115并核对echo | PASS所列事实；未覆盖Slider轨道拖动的全部平台样式 |
| NATIVE-UI-03 | offgrid默认12显示10，但初始echo12；真实ArrowRight后echo15 | PASS；显示、运行值与源码默认值分别核对 |
| NATIVE-UI-04 | spin1.25，实际增量箭头后1.5及echo | PASS |
| NATIVE-UI-05 | 真实枚举菜单选择Square，runtime shape="square" | PASS |
| NATIVE-UI-06 | text默认abcdef显示abcd而初始echoabcdef；真实ASCII输入123456789→1234，Ω😀xy→Ω😀x并核对echo | PASS；Qt按UTF16，不能冒充CLI UTF8字节策略 |
| NATIVE-UI-07 | 真实checkbox true→false、vector第一分量1→1.5，分别核对echo | PASS |
| NATIVE-UI-08 | 实际A(width30/shape square)→B(spin2，其余恢复默认)→Default(spin1.25)，四次精确标题独立复核 | PASS；没有上一集残留 |

12个自动检查与上表8个覆盖维度不是同一计数；源码buffer每步未变、disk未变，原用户偏好SHA前后相同。实际点击仅在最上层点击窗口归属精确PID时允许，popup菜单通过实际列表顺序向精确进程发送Home/Down/Enter，不点击WindowManager。

已经证实的兼容差异：Qt slider默认显示会量化，但未交互前runtime保留offgrid12；Qt文本显示受UTF16长度限制，但未交互前runtime保留abcdef。IDE按用户批准保持无损默认值与UTF8输入拒绝，不复制这些显示裁剪。Native ArrowRight由显示网格到15，IDE键盘按当前未舍入值加step；这不是所有交互完全同构的证明。

历史失败均保留于同一证据根目录：菜单Jump To重名、AXIncrement不等价真实步长、过早读取echo、AXWindow未就绪、popup角色AXCell/AXStaticText差异、WindowManager遮挡导致安全点击拒绝等。一次B的预期误以为native保留A已被实测否定；继续读取ParameterObjects.importValues可见缺失键会reset。旧失败保留为incorrect-B-expectation，最终按源码与实测均为defaults+当前集。没有将失败改称产品通过，也未为green修改IDE行为。

## 可复现入口与边界

`scripts/customizer-native-gui.mjs`在临时目录创建模型并启动目标；`.build/customizer-native-control`只接受精确PID和bundle路径、已授权的AX API及有限按键，不操作其他应用。`scripts/fixtures/customizer-native-gui.sb`保护真实偏好。截图和AX结果独立，截图成功也不能推断控件行为通过。

Swift辅助器从`customizer-native-control.swift`与`customizer-native-window.swift`编译到`.build`；当前支持有界dump、Customizer/Editor菜单、精确AX路径的操作和有限按键。窗口存活有10分钟上限，控制器报错和进程结束均需看真实handle；不能仅因截图等待超时重启未结束的进程。


可复现全流程：先编译两个Swift辅助器，再执行`SCAD_NATIVE_GUI_CHECK=1 node scripts/customizer-native-gui.mjs`。启动、截图、实际Qt控制、每步runtime echo、关闭及原偏好SHA检查由同一有界流程协调。任何中途失败会写dynamic-checks.json及可得的failed-native-state.json并非零退出；旧失败并未覆盖。大幅改变桌面焦点/修饰键或WindowManager覆盖会被记录或拒绝，不能用旧PASS替代本轮失败。
