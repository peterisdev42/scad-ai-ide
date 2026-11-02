# 文档索引

开发环境、目录职责、测试和打包命令见 [开发说明](../CONTRIBUTING.md)。产品方向见 [PRD](../PRD.md)，已交付功能以 [README](../README.md) 和实际代码为准。

## 当前实现

- [实验性按零件着色](part-colors.md)：按需 CSG 辅助、缓存、性能预算和限制。

- [Preview Exporter 架构](preview-exporter-architecture.md)：原生导出器、协议、Goldfeather 和边界。
- [Goldfeather 验收](preview-goldfeather-validation.md)：当前快速预览的测试和性能记录。
- [快速 Boolean 预览](csg-preview.md)：当前管线入口。
- [Preview 集成](preview-integration.md)：与独立 Preview 扩展的宿主边界。
- [通知约定](notifications.md)：通知身份、聚合和调用方式。
- [手动双向同步](../scripts/preview-sync/README.md)：映射、基线及冲突处理。
- [仓库整理报告](repository-cleanup.md)：审计依据、删除与移动清单、验证及保留问题。

## 历史研究与验收

这些文件用于追溯方案选择和对照性能，其中的命令、路径、功能状态与失败记录属于报告当时的实现，不应直接当作当前操作说明。

- [早期架构审计](architecture-research.md)
- [CSG 渲染研究](csg-preview-research.md)
- [CSG 基线验收](csg-preview-validation.md)
- [交互合并验收](csg-preview-merge-validation.md)
- [装配体回归](csg-preview-assembly-regression.md)
- [原生导出实验](preview-exporter-experiment.md)
- [逐片元 Boolean 验收](preview-exporter-validation.md)
- [标准 Mesh 方案验收](preview-standard-mesh-validation.md)

## 原始资料

[artifacts/](artifacts/) 集中保存性能 JSON、阶段记录及验收截图。保留原文件名和字节内容，包括旧渲染方案的基线；同名实验中的相同图片也保留各自来源身份。文档中的对应链接说明采样环境与限制。`images/` 保存面向用户的演示图片。
