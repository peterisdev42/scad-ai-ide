# Phase 0–4 收尾覆盖映射

此表是定位现有测试入口和缺口的索引，不是签署清单。只有本轮命令日志中确实执行、未 skip 且符合适用层级时才记自动 PASS。原 SPEC 内容作为需求材料；已批准的阶段范围与用户取消 MCP 的指令优先。

| SPEC | 自动化入口／实际断言范围 | 仍需独立证据 |
|---|---|---|
| D-01 | cad/real.acceptance parser；cad.integration dirty root Problems | 模型 strict 修复见 P1 |
| D-02 | cad/contracts exit-zero ERROR/assert；真实 CLI assert | 无额外平台推断 |
| D-03 | real.acceptance warning；diagnostics parser | 未知格式保留原文 |
| D-04 | dependencyResolution、contracts dirty/missing dependencies | 非自动安装 |
| D-05/D-06 | mesh.integration empty semantics；CLI valid CSG | 不把合法空集视为缺陷 |
| D-07 | execution Unicode 参数数组；diagnostic Windows parser | Windows 原生 M09 仍 KNOWN_PLATFORM_GAP |
| D-08 | execution stdout/stderr flood；contracts bounded error retention | 无 OS RSS 硬限声明 |
| D-09 | cad.integration shared owners、actual Preview and Agent | 双实际 Preview 实例关闭组合需逐条人工补证 |
| D-10 | real.acceptance dependencies；cad.integration included error | 不伪造外部位置 |
| D-11/D-17 | contracts old completion/change-and-restore；mesh/assembly race | Host 真实连续编辑/延迟执行需逐项定位证据 |
| D-12 | snapshot contracts/runtimeIdentity/dependencyResolution；cad.integration shadow/constraints | Runtime/Library/Customizer 实际 UI 切换全矩阵尚未完整签署 |
| D-13/D-14 | cad.integration actual Preview source command | M01 补 Text→Preview→关闭组合与显式跳 Text |
| D-15 | cad.integration two roots shared included error | 不按相同消息/行号关联 |
| D-16 | cad.integration external closed files、dirty dependency | 编辑 buffer 不等于磁盘已评估 |
| D-18 | cad.integration stale navigation；contracts snapshot mismatch | 导航时删除文件的实际 UI 补证 |
| D-19 | cad.integration owners、actual Preview/Agent | 多实际 Preview 同时打开的 UI 组合补证 |
| S-01 | schema/Trust 入口逻辑 | M07 真正 untrusted window，无 disable-workspace-trust |
| S-02 | contracts SharedTasks；mesh/assembly service independent/last cancel | 压力规模保持独立 |
| S-03 | Worker tests dispose/timeout recovery | M06/M10 真实移除项目／远程断开 |
| S-04 | execution capability probe/failure | 特定实际旧 Runtime 未运行则 NOT_RUN |
| S-05 | dispatcher failures；native oracle要求业务状态/终态 | 原生模型不能用 ok:true 当模型通过 |
| S-06 | Windows 原生 Unicode 历史失败 | M09，不将 parser 测试代替原生 |
| S-07 | native tool-exposure actual schemas/模型 ID/会话 marker | 51 个 catalog 数量不证明每轮全部暴露 |
| S-08 | cad.integration dirty；Native diagnostics strict disk invariant | P1 模型保存问题仍 OPEN |
| P2 格式／几何 | mesh format/geometry golden、worker/service/images/artifacts | 最大规模完整压力另记 |
| P3 约束／生命周期 | assembly registry/kernel/service/worker/real/Host | 真实固定基准修复要独立 model 证据 |
| P4 Diff／持久化 | review compare/store/feedback/geometry/worker + view/gpu + Host | 真人 M03–M05；全容量／断电 NOT_RUN |

自动入口：`npm run test:cad:closeout -- baseline`。Host 的文件为 `src/test/{cad,mesh,assembly,review}.integration.test.ts`；默认集覆盖 `src/test/{cad,mesh,assembly,review}/*.test.ts`。测试名称按实际输出保留，不能按文件存在推断执行。

资源上限复核应覆盖 CLI/Worker 各并发 1、队列 32、120/60 秒、600 秒装配总期限，128 MiB 原始字节／256 MiB 3MF 解压、V8 heap 512 MiB／显式数组 256 MiB；图片最多4×1024²、inline≤4 MiB、摘要≤32 KiB。现有小预算边界和恢复测试通过，只证明其测试参数；最大规模和完整耐久需另附证据，保持 CAD-STORE-STRESS-01 开放。

2026-11-17 新增 Host 回归：canonical CLI paths project to the workspace editor URI for roots and dependencies。收尾首轮使用 `/var` 临时工作区，暴露 CAD-P1-URI-04；旧 `.build` 路径运行未覆盖该组合。修复后同时测试 canonical/lexical 输入，不通过把 fixture 改回非别名路径来隐藏问题。
