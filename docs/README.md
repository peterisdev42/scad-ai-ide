# 文档索引

这里保留与当前 SCAD AI IDE 实现相关的使用说明、设计约定和验收入口。产品概览见 [README](../README.md)，开发与发布见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 使用与运行

- [Preview 集成](preview-integration.md)：模型预览、Webview、Markdown 和测试入口。
- [Preview Exporter](preview-exporter-architecture.md)：Full Render、实验性快速预览及其限制。
- [Preview Problems 生命周期](preview/problems-lifecycle-navigation.md)：诊断归属与源码导航。
- [按零件着色](part-colors.md)：实验性视觉功能及边界。
- [库管理](library-manager.md)：依赖解析、版本锁定、安装与清理。
- [开发缓存](development-caches.md)：开发模式的缓存观察与管理。
- [通知规范](notifications.md)：统一的通知和错误处理接口。

## 架构

- [Customizer ADR](customizer-architecture-adr.md) 与 [源码编辑](customizer-source-authoring.md)。
- [CAD 验证架构](cad-verification-architecture.md)、[原始网格与测量](cad-mesh-verification.md)。
- [CAD Phase 2 / Mesh](cad/phase2-architecture.md)、[Phase 3 / Assembly](cad/phase3-architecture.md)、[Phase 4 / Frozen Review](cad/phase4-architecture.md)。
- [AI 功能声明](ai-feature-architecture.md)、[Agent 能力与授权](agent-capability-matrix.md)、[GUI/Agent 一致性](gui-agent-parity.md)。

## 验证与未闭合项目

- [Agent 工具目录](agent-capability-catalog.md)（自动生成）、[验证指南](agent-verification.md) 与 [Codex 验收 SPEC](agent-codex-acceptance-spec.md)。
- [CAD 总体状态](cad/overall-progress.md)、[收尾问题](cad/acceptance-closeout.md)、[覆盖矩阵](cad/closeout-coverage.md) 与 [手动验收清单](cad/manual-acceptance.md)。
- [Customizer 收尾状态](customizer/closeout-report.md) 和 [Windows Unicode 已知限制](customizer/windows-unicode-closeout.md)。

## 历史资料

过期阶段报告、测试日志、截图、JSON 快照及大型验收证据已从当前工作树移除，以免与最新功能状态混淆。需要审计时，可在 [清理前的 Git 提交](https://github.com/peterisdev42/scad-ai-ide/tree/9b4fcd3301defa86a10f311f2a52fc42e7767878/docs) 查看；保留文档内涉及历史证据的链接也指向该不可变提交。

新测试输出应写入 `.build/` 或 CI Artifacts，不应再次把原始验收产物提交到 `docs/`。
