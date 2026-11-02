# Preview Exporter 原生独立实验

2026-11-02，macOS 27.0 ARM64 / Apple M4 Pro。

使用发布资产 `openscad-2026.11-RC0/openscad-preview-exporter-macos-arm64.tar.gz`，下载 archive 和 `.sha256`，实测 SHA256 均为：

```text
42ebdbe75f3d8bf25c61675f756c86206b6a14077a5ea078fad355babf69a14f
```

归档安全检查和独立安装器均验证通过。实际文件探测为 `Mach-O 64-bit executable arm64`；wrapper 使用自身包内相对 `OpenSCAD.app/Contents/MacOS/OpenSCAD`，未覆盖普通 CLI。`--version` 输出 `OpenSCAD version 2026.11-RC0`。

`build-info.json` 确认 `preview_exporter=true`、`preview_scene_schema=1`、`target=macos-arm64`、上游 commit `9ba0cee7c94785fac0ca8dfe040b965a12a25ed1`。二进制元数据记录 builder commit `7d60f7a42610d848bc1c07ec0b21ac34d175ae28`；本次审阅的 Builder checkout 为 `fdb84054d93cf701fbeda70d3f907afd0b56636b`。

首先实际导出的差集：

```scad
difference() {
    cube(20, center=true);
    sphere(12, $fn=24);
}
```

```sh
openscad-preview-exporter --export-format=preview-scene -o model.csgp model.scad
```

结果为合法 JSON Schema v1：2 个 mesh、2 个 instance、1 个主 Product；cube 为 8 顶点/12 三角形，sphere 为 288 顶点/572 三角形。主 Product 的 intersections 指向 cube，subtractions 指向 sphere，flags 均为 0。默认颜色为 `[-1,-1,-1,-1]`，矩阵为行优先 4×4。未出现伪造的 program/root/topologyRoot 字段。

之后生成并提交了少量可复现 `.scad` / `.csgp` fixtures，覆盖基础体、三个 Boolean、多层嵌套、变换、RGBA、Highlight/Background、空模型、凹多边形、64 实例、大坐标、共面和薄壁；不包含私有路径。原始 fixture 位于 `src/test/preview/fixtures/prepared/`。参数、stdin、include/use/import、OPENSCADPATH、取消与错误都通过真二进制测试。

最终安装器还通过完整归档安装、重新发现、校验失败拒绝、独立能力识别和损坏安装修复测试。真实 CLI 验证没有证明它是最终 Boolean 网格；GPU 显示始终按 Products 求边界。
