# 文档索引

这里维护与当前代码对应的使用说明、架构边界和验证方法。产品功能见 [README](../README.md)，环境准备、目录职责和构建发布见 [开发说明](../CONTRIBUTING.md)。

## 功能与架构

- [Preview Exporter 与 Goldfeather](preview-exporter-architecture.md)：两条渲染路径、协议、安装、性能记录和限制。
- [Preview 集成](preview-integration.md)：宿主生命周期、Customizer、Markdown、构建与回归入口。
- [按零件着色](part-colors.md)：使用方式、按需辅助数据、缓存和准确性边界。
- [第三方依赖库管理](library-manager.md)：Registry 布局、精确版本、锁文件、安装恢复与清理。
- [开发模式缓存管理](development-caches.md)：缓存范围、内容展示、清理和开发模式约束。
- [通知约定](notifications.md)：共享通知入口、聚合、恢复和用户确认。

## Agent 与本地模型

- [Phase 2 网格与测量](cad-mesh-verification.md)：原始 STL/3MF、测量、冻结 PNG、预算和验收边界。
- [CAD 验证架构](cad-verification-architecture.md)：无 Preview 的 CLI 诊断、快照、共享 Problems 和边界。
- [CAD 初始验收记录](cad-agent-acceptance.md)：Phase 0–1 的历史 Host、CLI 与 Agent 验收证据。
- [CAD P0–P4 总体进度](cad/overall-progress.md)：最终候选、模型和主机验收边界；MCP 不属于当前交付范围。
- [CAD 手动验收](cad/manual-acceptance.md)：真实交互、工作区、信任和跨平台的待验项目。

- [共享能力与权限矩阵](agent-capability-matrix.md)：四模块服务、GUI/Agent 边界和安全约束。
- [完整工具目录](agent-capability-catalog.md)：由能力 Registry 生成的 51 项原生 VS Code Agent Tool 清单。
- [Agent 验证指南](agent-verification.md)：自动化入口、真实模型验收方法、已知失败和未验环境。
- [Copilot harness 复验记录](cad/copilot-harness-acceptance.md)：实际会话身份、本地模型路由和未闭合的工具发现问题。
- [Customizer 收尾结果](customizer/closeout-report.md)：已执行验证、历史证据及未闭合项目。

[Preview 手动双向同步](../scripts/preview-sync/README.md) 单独维护源码映射、基线与冲突处理。

测试日志、截图与性能采样输出到 `.build/` 或临时目录；它们记录对应运行的结果，不作为现行能力说明。
