# 参数被后续赋值覆盖：诊断与空状态修正

2026-11-10。用户明确批准本项修复；此前全量架构目标继续暂停，没有启动模型测试。该修复发生在最终交接基线 5aee2e5 之后，旧 VSIX 和 artifact.json 仍记录原先的产物，不能当作包含本修复的新包。

新增 `CUST-VIS-01` / `CUSTOMIZER_PARAMETER_OVERRIDDEN`，等级 Warning。只针对：原先可生成控件的声明，被第一个代码块之后的顶层同名赋值覆盖。主位置指向最终覆盖赋值，relatedInformation 指向原参数声明。区域内合法重复赋值、模块局部变量、显式 Hidden 不新增警告。诊断不依赖 candidates 输出，也不自动删除或搬移源码；安全修复仍仅允许已有确定性注解替换。

Sidebar 全部控件因此消失时显示具体原因及“Go to overriding assignment”按钮，跳转使用当前领域状态的位置；沿用 target/revision 验证，拒绝过期或其他文件的消息。部分控件消失时其余控件仍正常显示，Problems 标出受影响参数。修复或关闭目标后清除相关状态。GUI 与 Agent 分析/验证共用这条规则；显式 visible 契约失败时 contractStatus=mismatch，qualityStatus=warnings，semanticPass=false。

没有改动参数发现、可见性或求值语义，没有声称已验证该重复声明案例的上游兼容性。原生 OpenSCAD 精确差分仍 NOT RUN，后续若发现原可见性规则不兼容，需另行修正和验证。

## 验证

- PASS：`npm run compile`（catalog、类型、lint、构建）。
- PASS：`npm test`，core 219 / Preview 99 / Library 26；Library 3 SKIP（默认入口未提供对应 native CLI/Exporter/online 条件）。
- PASS：实际 Chromium，`node --test scripts/customizer-scrollbar.test.mjs scripts/customizer-preview-fields.test.mjs`，42 项。含具体空状态、实际点击导航、过期/错目标拒绝、修复后隐藏按钮、无参数普通空状态恢复。
- PASS：隔离 VS Code Host，`vscode-test --grep 'Customizer lost-control Problems'`，1 项。验证真实 Warning、原声明关联、无自动删除 Quick Fix、unsaved 修复后清除以及磁盘原样。
- PASS：只读分析用户磁盘 `rpi.scad`，0 参数、13 条新 Warning；关联第 42→5、44→7 等前后声明；要求 vBoard_l 可见时契约 mismatch。未修改用户文件。
- 保留首次失败：浏览器沙箱启动失败；新增 Host 用例遗漏局部 waitFor 函数（测试代码错误），已补齐并通过类型检查与真实 Host 复测；新增 GUI 消息最初缺少分类/生成文档，已补齐并通过检查。
- NOT RUN：新 VSIX 打包/安装、完整 Host 全套、此案例上游原生差分、真实模型。旧交付报告中的 FAIL / SKIP / NOT RUN 没有因本项修复变为通过。

[原始验证证据](evidence/parameter-override/)。
