# 快速 Boolean 预览

快速预览已经整体替换为 OpenSCAD Preview Exporter → `.csgp` → PreviewScene → GoldfeatherRenderer。旧 `.csg` Parser、TypeScript/Manifold 几何求值、Boolean Normalization、Scene v3 与 Raster CSG Renderer 已删除。

安装、协议、架构及工具边界请阅读 [Preview Exporter 架构](preview-exporter-architecture.md)，测试和性能数据请阅读 [验收记录](preview-goldfeather-validation.md)。Full Render 继续使用独立的普通 OpenSCAD CLI。
