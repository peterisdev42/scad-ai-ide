# 真实 Extension Host 生命周期验证

2026-11-09。本次新增真实最低 VS Code 1.140.0 Extension Host 的 V8 heap snapshot，补充此前注入文档/事件接口的 Node 测量。证据见 [host-lifecycle-memory.json](evidence/host-lifecycle-memory.json)。

## 测量范围

使用独立临时 workspace/profile/shared-data-dir/extensions，关闭额外扩展和LSP。实际激活本扩展，以编译后的生产 SourceDomain/EditorActions 类连接真实 VS Code TextDocument、workspace事件和文件系统；不是mock，也不是安装后minified bundle的全产品测量。

Host Node v24.21.0、macOS arm64。预先打开32个真实文档，每份117,044 bytes。每轮填满16文档分析缓存、32个Source plans、32个Editor plans，随后dispose并强制V8 GC。1轮预热后测量6轮，不commit、不保存，所有文档保持非dirty。

通过inspector保存三个完整Extension Host heap snapshot，再由Host外进程解析V8节点。对象名必须在占用阶段观测到额外活实例，不能只比较两个相同的无关基线。

| 实际对象实例 | 预热后基线 | 计划池填满 | 六轮销毁后 |
|---|---:|---:|---:|
| CustomizerSourceDomainService | 1 | 2 | 1 |
| CustomizerEditorActions | 1 | 2 | 1 |

两类额外服务实例均被回收；真实workspace事件订阅未将这些已dispose实例继续保留。每轮各Map清空的断言也实际执行。每轮GC释放3,600,784–3,796,160 bytes。

## 限制与异常

宿主整体销毁后堆值区间仍为8,028,740 bytes，不能从这项结果断言整个Host无泄漏，不能把这段背景增长直接归因于Customizer。测试没有覆盖renderer/GPU、所有GUI/Preset服务、所有provider或安装bundle的全部生命周期。

首次启动因默认macOS临时目录导致Unix socket路径超过103字节，未进入测试。改为短`/tmp/cmem-*`目录后执行成功；两快照初测和增加活实例对照的三快照测量均保留。测试失败没有写成通过。

原始三快照压缩归档位于仓库`.build/customizer-host-memory/{baseline,occupied,final}.heapsnapshot.gz`，共约40MB。JSON证据包含压缩和解压前SHA256；不将大体积heap或私有profile打入VSIX。完整heap来自隔离合成fixture，不复制用户日常profile。

## 复现

```sh
npm run compile-tests
SCAD_VSCODE_EXECUTABLE='/absolute/path/to/Visual Studio Code.app/Contents/MacOS/Code' \
node scripts/customizer-host-memory.mjs
```

入口：[Host controller](../../scripts/customizer-host-memory.mjs)、[真实Host fixture](../../scripts/fixtures/customizer-host-memory.cjs)。结果仅对上述服务与场景有效，整个SPEC目标仍未完成。

## 2026-11-10 GUI Domain/Preset 实际堆回收补验

新增可选 SCAD_HOST_MEMORY_GUI=1，以同一真实1.140.0 Host连接编译后的生产 CustomizerService/CustomizerDomainService/CustomizerPresets。每轮32个真实文档分别导入同一含约119KB额外metadata的合成Preset，再选择A（width45），形成32个文件缓存和32份Overrides；一个真实文件watcher、一份值订阅和一份preview订阅均被占用。1轮预热后测6轮，断言dispose清空controller缓存、watcher和Domain私有source、撤销订阅，同时不清空共享service值；最后验证源文档非dirty和Preset原bytes不变。

三份V8完整快照中，SourceDomain、EditorActions、CustomizerService、CustomizerDomainService、CustomizerPresets五类额外实例分别均为0→1→0。与旧测量的1→2→1不同，本轮Production minify与开发类基线不同，按同轮实际增量判定，不强行沿用历史绝对数。每轮GC释放7,516,756–7,844,792 bytes，销毁后used heap区间185,808 bytes。见[新数据](evidence/host-gui-lifecycle-memory.json)，历史Source/Editor证据未覆盖。

三份原始heap压缩存于.build/customizer-gui-host-memory，压缩前后hash在JSON中。仅JSON摘要入repo，不复制完整heap/profile到VSIX。该结果覆盖上述服务在真实TextDocument/文件watcher场景的回收，不覆盖GUI renderer/GPU、安装minified bundle对象、远程provider或所有竞态；不能宣称整个应用无泄漏。
