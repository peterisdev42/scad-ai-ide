# Phase 4 实施与验收

已交付摘要 Diff、持久基准、冻结证据视图、空间反馈服务和显式打印筛查。**Gate P4 未闭合**：真实 Agent 两场各一次 240 秒尝试均未完成，完整 Host／installed 仍有窗口焦点缺口；动态工作区移除用例保留为待验。未将自动化点选当作真人验收。

## 交付范围

- P4A：v2/v3 原始报告与网格的有界持久存储、内容校验、原子索引、跨进程锁／租约、CAS 批注修订及原锚点历史；按稳定作者 partId 或整个文档比较几何、位置、测量与约束。约束改变／删除返回未决；独立零件保护和必需检查回归产生可追溯问题。
- P4B：复用 Stage 的独立冻结视图、基线幽灵层／目标变化颜色、距离线和批注；原始 Float64 拾取与显示 Float32 分离，记录重定位、相机原点与量化误差。普通 Preview 只增加已有证据入口。
- P4C：人机定位请求、显式提交、取消、单请求限制、current／stale 生命周期、严格同 raw mesh 的刚体重映射候选和人工确认；批注 resolved 不代表模型 PASS。空间来源不推断 SCAD 参数行。
- P4D：本地毫米 FDM profile Schema、单件局部坐标下的打印姿态、保守包络及数值悬垂候选；始终返回 `printability: NOT_CHECKED`。没有厚度、桥接、支撑、切片、实体差或零件内部局部保持证明。
- 新增五个工具和三个 Skills，资源清单为 **51 Tools / 12 Skills**。原 diagnostics v1、mesh v2、assembly v3 保持兼容；派生比较／打印／反馈各有版本化契约。

持久数据默认上限每项目 1 GiB／32 快照、64 MiB 元数据／1000 批注；无 TTL、无静默淘汰。几何任务复用并发 1／队列 32，Worker 60 秒、V8 heap 512 MiB，显式数组预算 256 MiB；这不是 OS RSS 硬上限。图片仍从冻结网格生成，历史 ID 不触发源码编译。新增工具摘要按 32 KiB 检查；已提交批注使用有标记的有界投影，完整锚点与历史保留在本地。

## 最终验证

| 项目 | 结果与证据 |
|---|---|
| 类型、lint、生成资源与打包 | 通过；[类型](evidence/phase4/types.txt)、[lint](evidence/phase4/lint.txt)、[资源生成测试](evidence/phase4/manifest-tests.txt)、[包与 bundle 绑定](evidence/phase4/archive-binding.json) |
| 默认测试 | **436 PASS / 3 SKIP，exit 0**；包括 19 项新增 review 单元／Worker 测试；[默认日志](evidence/phase4/default-tests.txt)、[review 日志](evidence/phase4/review-unit.txt) |
| 几何与持久性 | 文面重排／绕序／单位、约束放宽／删除、独立零件保护、重映射、重复问题 ID、锁／CAS／重启／损坏／容量、Worker 超时／取消／恢复均有测试；不把已有 P1/P2/P3 Gate 继承为通过 |
| 冻结视图 | WebGPU／WebGL2 Stage 渲染与拾取通过；生产入口的 Hash 分块、错误 nonce、显式模拟提交和原始 Float64 射线复核通过；[GPU](evidence/phase4/evidence-gpu.txt)、[入口](evidence/phase4/view-entry.txt)、[自动化截图](evidence/phase4/automated-frozen-view.png)；这些是自动化证据 |
| Preview 性能 | 同机、同 largeBoolean 夹具、固定基线 `12c1063`，每后端 40 次预热／160 次测量 drawFrame + GPU 完成时间。p95 WebGPU 约 1.0→0.9 ms，WebGL2 约 9.2→9.2 ms，满足退化不超过 max(10%, 1 ms)；[数据](evidence/phase4/preview-performance.json) |
| 完整 Host | 最低 1.140.0 与 Stable 1.146.0 的最终结果见 [运行记录](evidence/phase4/host-runs.json)。Phase 4 已执行的五项通过；动态文件夹变更一项 pending；完整套件的三个原生焦点失败不计 PASS |
| 生产安装 | 51 工具注册、基线保留／释放、比较、单件打印包络和未检查项通过；[review 子流程](evidence/phase4/installed-review.json)。完整 installed 在原生焦点等待超时，exit 1；[原始日志](evidence/phase4/installed.txt) |
| 真实 Agent | 下列两个场景均未通过，不重试。最终候选与每次实际测试的 bundle Hash 分开保留 |
| 跨平台／发布 | Linux／Windows／远程宿主未运行；Windows Unicode 继续为 `KNOWN_PLATFORM_GAP`。不签署跨平台发布 Gate |

本机 Node 24.16.0、Darwin arm64、官方 OpenSCAD `2026.11-RC0`。当前 Stable 1.146.0 与 [官方发布说明](https://code.visualstudio.com/updates/v1_146) 核对。实际命令、退出码、宿主版本与环境路径保留在证据中。

## 未闭合项

- **CAD-P4-AGENT-01 / FAIL**：F5 oMLX Provider 0.1.2、Qwen3.6，单场 240 秒。模型成功分析当前源码，随后把 v2 原始报告 ID 作为 `model_compare.reportId` 读取，未在总期限内完成比较与打印流程。已补清“创建比较必须 baselineReportId + targetReportId；reportId 只读已有比较结果”的 Schema 说明与错误提示。原始失败保留，未重跑；该场不作为最终候选的 Agent PASS。见 [assessment](evidence/phase4/native-comparison/assessment.json)、[轨迹](evidence/phase4/native-comparison/tool-traces.json)、[Provider 暴露](evidence/phase4/native-comparison/tool-exposure.json)。
- **CAD-P4-AGENT-02 / UNRESOLVED**：独立单场 240 秒。预检装配通过；模型读取反馈并提出定位请求，但原生工具确认在期限内未完成，没有实际表面提交、没有几何修改。已通知用户所需窗口与操作，期限结束后停止。Manifest／profile Hash 和磁盘源码仍保持验收基准。见 [assessment](evidence/phase4/native-feedback/assessment.json)、[原生确认](evidence/phase4/native-feedback/human-needed.json)。不将意愿回复或自动化点选计作真人闭环。
- **CAD-P4-HOST-01 / ENV_FOCUS_NOT_ACQUIRED**：完整宿主与 installed 的原生 Undo／Redo／Enter 焦点检查仍失败，延续此前环境缺口。
- **CAD-P4-HOST-02 / ENV_WORKSPACE_UPDATE_REJECTED**：实际动态添加／移除工作区测试被宿主拒绝或未收到完成事件。原始失败日志保留；现以 `SCAD_TEST_DYNAMIC_WORKSPACE=1` 显式启用，默认 pending，不计通过。产品每次枚举仍重新核对持久 store 的当前工作区归属。
- 最初无效报告错误文案兼容性回归已恢复；比较部分解析失败的引用泄漏、保留图片的字节 Hash 和多个回归规则的问题身份已修复并补测。
- 首次保留 PNG 验收因运行环境指纹变化被安全拒绝；测试夹具等待 Runtime 探测完成后复验通过，原始失败仍保留。未关闭一致性保护来获得通过。
- 真实跨进程崩溃／断电耐久、完整容量／最大网格压力、真实刚体重映射人工确认和真人空间修复尚未验收。已实现的限制与纯函数测试不替代这些证据。

## 分支与交付

依赖基线 `12c106372be287f50775320bb79c97e1077f337c`，分支 `codex/cad-diff-feedback`。PR 面向 `main`，依赖 Phase 3 PR #4（以及 #3／#2）；[Phase 4 增量比较](https://github.com/peterisdev42/scad-ai-ide/compare/12c106372be287f50775320bb79c97e1077f337c...codex/cad-diff-feedback)。主分支保持 `8a3ff1fe394b11aeb7fb323e7319bd365d29abaa`，未直接修改或提交 main，未合并或发布。

草稿 [PR #5](https://github.com/peterisdev42/scad-ai-ide/pull/5)；最终交付 HEAD 记录于 PR 说明，验收代码 HEAD 与实际命令见 [交付记录](evidence/phase4/delivery.json)。VSIX 位于 `.build/scad-ai-ide-phase4.vsix`；不将本地构建当作已发布产品。
