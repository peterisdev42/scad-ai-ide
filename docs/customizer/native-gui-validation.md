# 原生 Desktop 验收进度与待测矩阵

2026-11-09；不是全部通过报告。原生操作已经用户授权，不再重复请求辅助功能授权。当前Accessibility与CGPostEvent权限均true；之后实测WindowServer `CGSSessionScreenIsLocked=1`，解锁是剩余前提。

## 独立二进制与执行证据

从[官方snapshot目录](https://files.openscad.org/snapshots/)取得2026.11.06 macOS universal DMG，并与[官方SHA256](https://files.openscad.org/snapshots/OpenSCAD-2026.11.06.dmg.sha256)核对：`bf3c71ae90420b2cd08f09d4dfc42a5bd0d2481b23f895b671820fdabe7ce6ac`。只读挂载在仓库`.build`，没有安装到`/Applications`。

实际窗口状态栏显示git `a81e8630`；本地源码解析为`a81e863051c42ee04168683e945aca58d32d04a2`。与pinned `bcf45a22...`比较，`src/core/customizer`、`src/io/export_param.cc`、`src/gui/parameter`及ParameterWidget.cc/h没有差异。这仍不是完整pinned binary。

- Desktop二进制执行既有41例`.param`差分：**41 MATCH**，参考fixture没有漂移。[结果](native-desktop-cli.json)。这证明CLI导出范围，不能替代GUI。
- 已捕获过实际原生模型窗口，证明GUI启动及OpenGL视口；当时Customizer隐藏，**不算控件验收**。
- 用户开启权限后，当前截图返回SCStream -3811、目标无法激活且AX树不完整。锁屏状态已独立查明。没有把这些失败转成通过，解锁后必须复测。

## 用户偏好保护与恢复

首次假设`CFFIXED_USER_HOME`可隔离Qt Native QSettings，实际失败：只有recentFileList被测试文件改变。启动前私有备份已保留；确认当前SHA仍与测试后结果一致、唯一改动键且包含本次fixture后，通过defaults恢复，逐值比较与原始偏好一致。plist重新序列化后的byte hash可以不同。恢复证据只记录hash/键名，不归档用户偏好内容：[恢复记录](evidence/native-gui-preference-recovery.json)。

之后改用macOS原生sandbox，禁止所有user-preference-write及真实home的直接文件写入。独立defaults写探针确实被拒绝，测试域未创建。后续截图测试原偏好SHA完全不变。后续动态测试也使用该sandbox；不能退回仅环境变量隔离。

## 动态检查矩阵（未执行项不算通过）

| ID | 合成fixture与应检查的事实 | 当前状态 |
|---|---|---|
| NATIVE-UI-01 | Window→Customizer显示实际控件；Width描述来自紧邻列首注释；Hidden internalOffset不出现在可调控件 | 待解锁；菜单/控件树尚未取得 |
| NATIVE-UI-02 | width默认120、声明0:5:100；观察实际上界、初值、箭头与指针行为 | NOT RUN |
| NATIVE-UI-03 | offgrid默认12、步长5；分别记录显示值、交互后值、运行时值与源码默认值 | NOT RUN；不能由CLI接受12推断GUI也保持12 |
| NATIVE-UI-04 | spin默认1.25、步长.25；原生增减后的实际值 | NOT RUN |
| NATIVE-UI-05 | shape round/square和标签；真实选择并核对运行时值，源码默认不保存 | NOT RUN |
| NATIVE-UI-06 | text默认abcdef、长度4；记录初始显示、ASCII/多字节输入限制及实际应用值；区分GUI与Preset import | NOT RUN |
| NATIVE-UI-07 | checked复选框及vector三个分量的真实变更 | NOT RUN |
| NATIVE-UI-08 | 默认值/部分Preset A→B→Default，验证显示与运行时残留 | NOT RUN；需先准备有界侧车fixture再操作 |

源码已显示两个必须区分的路径，尚未把下面预测写成实测结论：ParameterSlider.setValue经sliderPosition四舍五入，信号和commitChange可能将值转换到网格；ParameterText使用QLineEdit.setMaxLength，而Preset StringParameter.importValue使用UTF-8 byte substr。已有IDE批准的无损校验/存储政策不因这些未执行GUI测试自动改变，后续按实际结果记录兼容性差异并补ADR。

## 可复现入口与边界

`scripts/customizer-native-gui.mjs`在临时目录创建模型并启动目标；`.build/customizer-native-control`只接受精确PID和bundle路径、已授权的AX API及有限按键，不操作其他应用。`scripts/fixtures/customizer-native-gui.sb`保护真实偏好。截图和AX结果独立，截图成功也不能推断控件行为通过。

Swift辅助器从`customizer-native-control.swift`与`customizer-native-window.swift`编译到`.build`；当前支持有界dump、Customizer/Editor菜单、精确AX路径的操作和有限按键。窗口存活有10分钟上限，控制器报错和进程结束均需看真实handle；不能仅因截图等待超时重启未结束的进程。
