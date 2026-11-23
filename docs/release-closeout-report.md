# Release System 收尾验收 · 2026-11-23

本轮基线为 `main@0d73b32bebae7ea195e6ad226c17679c2a3a82a2`。`docs/specs/release-closeout-fix-spec.md` 在工作树、可见 Git 历史和远端 `main` 均不存在。以下 Phase A–E 按用户指定的优先级、当前 CI 和附件可核对的要求执行。附件第 8 节覆盖身份配置与只读市场验收，第 12 节提供终验格式。

## Phase A–E

| 阶段 | 变更与证据 | 状态 |
| --- | --- | --- |
| A · Windows Git Staging | `scripts/release/build/build.mjs` 用 Git 报告的仓库根路径配置隔离 staging 的子模块来源。先确认真实路径和冻结对象，再启用本地文件传输，最后复核各子模块 HEAD。`scripts/release/test/build.test.mjs` 覆盖带空格路径、冻结父提交和 gitlink、脏工作树、不可用 origin 下的本地来源、未初始化子模块回退和来源不可用的退出码 5。 | macOS ARM64、Ubuntu x64 的 Release 套件各 23/23。Windows 修复版待目标机回归。 |
| B · Ubuntu Assembly | `src/test/assembly/service.test.ts` 用受控分析阶段触发取消、修改 stamp 和失效通知。负面断言覆盖单个订阅者取消、最后一个订阅者取消后迟到结果被丢弃、立即重试，以及输入变化与主动失效均不发布报告。旧夹具在输入物化延时 25 ms 时可复现 CI 的 `1 !== 2`。 | macOS ARM64、Ubuntu x64 的 Assembly 套件各 23/23。生产服务代码维持既有取消和缓存逻辑。 |
| C · Release 与整体验证 | 保留现有三平台 CI、架构门禁和 Publisher 防重传机制。`test:release` 包括断线后仍缺失、跨进程防重传、已存在包对账、并发锁、写盘失败和身份错配。 | 两个已验证平台 Release 全通过。本轮改动尚无远端 CI 数据。 |
| D · Windows OpenSCAD Unicode | 复核 `0d73b32` 原始 Windows 工件。ASCII 控制组通过。仅改变 Unicode source 导致退出 `3221226505`，仅改变 output 或库根也分别失败。两项 Windows 原生门禁失败。复现和候选包接收条件见排障文档。 | 发行包层可独立复现，包配置与上游源码之间的归因仍需同源独立构建对照。Windows 发布阻断。 [排障及修复指导](customizer/windows-unicode-closeout.md) |
| E · 同套工件与身份 | 用修复后的 Builder 对冻结 `0d73b32` 离线构建四平台 VSIX。静态校验通过，dry-run 返回双市场八项 `local-verified`。缺少 publisher 时只读 status 返回 `configurationMissing`，退出 2。 | 市场身份待维护者确认。Windows 最终运行证据待补。 |

Windows 历史 CI 日志将旧失败定位在 `git submodule update`，当时 Git stderr 被屏蔽，具体 Git 内部错误无法从该日志确认。旧代码用真实路径判断可复用性，再将 Node 拼接的 Windows 路径交给 Git 作 URL。本轮保留 Git 自己返回的路径拼写，并将 URL 写入 staging 的本地配置。错误会报告具体冻结子模块路径。

将新增 staging 回归放回旧 Builder 时，两个用例均失败。旧 Builder 既未持久化 staging 本地 URL，也未返回带子模块路径的失败说明。该对照在 macOS 运行。Windows 原生修复版仍需独立验证。

Assembly 旧测试在发起调用后固定等 10 ms 便取消。如果输入物化尚未完成，第一次调用可以合法地在分析开始前退出，导致旧测试只计到重试的那一次。原 CI 的 `1 !== 2` 与该顺序吻合。本轮用夹具发出的分析开始信号固定测试顺序，并让被取消的工作刻意返回结果，以验证服务能丢弃它。

## 本轮测试与 CI

| 平台 | 本轮结果 |
| --- | --- |
| macOS ARM64 | `check-types`、`compile-tests`、`lint`、`package`、`check:agents` 和 `check:customizer:architecture` 通过。`npm test` 444 通过、3 条件未运行，Assembly 23 通过。Assembly service 测试连续 25 轮通过。`test:release` 23、Agent Manifest 4、架构负面测试 11 通过。指定原生 CLI 后 Library 27 通过、2 条件未运行，真实 CAD 1 通过。 |
| Ubuntu 24.04 x64 来宾 | Node 24.22.3、Git 2.43.0、glibc 2.39。`npm ci`、`check-types`、`compile-tests`、`check:customizer:architecture` 通过，架构负面测试 11、Release 23、Assembly 23、Library 27 和真实 CAD 1 通过。Assembly service 测试连续 10 轮通过。Library 有 2 项按既有条件未运行。 |
| Windows x64 | 本轮修复版 Release/Assembly 和最终 VSIX `not-run`。现有真正 Windows CI 的原生 Library 26 通过、1 失败、2 条件未运行，真实 CAD 1 失败。 |

当前远端 `main` 的 Agent CI 中，macOS Contracts、Panel、Extension Host 通过，Windows Contracts 在 Release staging 失败，Ubuntu Contracts 在 Assembly 取消测试失败。已修复工作树尚未推送。 [Agent capability parity](https://github.com/peterisdev42/scad-ai-ide/actions/runs/44696437592)

当前远端 `main` 的 Library CI 中，macOS 与 Ubuntu 通过，Windows 的 Library/CAD 原生门禁失败。 [Library Manager](https://github.com/peterisdev42/scad-ai-ide/actions/runs/44696437510)

## Plan、工件和运行证据

本地工件在 `releases/closeout-2026-11-23.uoqRuz2q/`，包源码由 Plan 固定到 `0d73b32bebae7ea195e6ad226c17679c2a3a82a2`。工作树的 staging 修复参与本次打包，Assembly 测试改动仅用于回归。`offline-fixture` 是离线身份，未预留版本。

- Canonical Plan SHA-256 `e728050a76adb4a43bd3973035db79b7b376b1e821a830aa178076168dd87344`
- Canonical Artifact Manifest SHA-256 `de8d4f1761b9a07a09ea53ed34284a6e48a2f820f29d26963458dde2bda08c66`

| 目标 | VSIX SHA-256 | LSP SHA-256 | 运行验收 |
| --- | --- | --- | --- |
| `darwin-arm64` | `22a737d83a6e982295dfcd35cc4fe882686cc77b354b694e6e8888bf15176cf1` | `9e86039a448eb299bab72411823cde9c973f7e7aa00ba83fa2dc81341646e9a3` | CLI、stdio、VSIX 安装及激活通过。 |
| `darwin-x64` | `163b525115860e85f84e13ab7880671884512ef2b9325a27b3e0142c36f8bca3` | `d6f3bc86326ca4b49ee9596f636c6e6493f3f13593974a450ed1560f05267ba3` | Rosetta x64 的 CLI、stdio、VSIX 安装及激活通过。扩展宿主核对了 `process.arch`。 |
| `linux-x64` | `eea8bc93656ed700107683b3949079de95acb33d4165292aa245fb860328b944` | `eae1807fc628cf426c5dc0b0df10d9b9c46f08021a0c58cb3780420429ec3979` | Ubuntu 24.04 x64、glibc 2.39，CLI、stdio、VSIX 安装及激活通过。 |
| `win32-x64` | `9eb13a740c07f9337d6bf5efa5446ca9b73758f9c2ba65ff7e45108638f8da26` | `3b4f5505329928523610c2318957e801181dc9184fffa23fdbb301e4fd4f6e12` | 交叉构建与静态校验通过，实际 CLI、stdio、安装激活 `not-run`。 |

三个成功的运行报告各自绑定上述同一 Manifest 和对应 VSIX 的 SHA-256。macOS 两个 Extension Host 从沙箱内启动时退出 `SIGABRT`，在桌面环境重试后通过。Linux 初次启动因 VS Code 解包在 `nosuid` 挂载点，Chromium sandbox helper 配置不生效。按原生要求设置 helper 属主及权限，在可用挂载点重试通过。Windows MSVC 及 Linux/macOS 最低支持版本的 ABI 验收仍待覆盖。

## 终验清单

| ID | 结果 |
| --- | --- |
| A01 | 通过。类型检查和测试编译通过。 |
| A02 | 通过。架构基线缺失/损坏、非法导入与循环等 11 项回归通过。 |
| A03 | 已配置三个系统的默认 Release CI，基线 Windows 失败明确可见，修复版待运行。 |
| A04–A06 | 通过。模拟断线且仍不可见时跨进程只上传一次，匹配恢复，冲突及不可验证阻断。dry-run 和只读对账保留本地历史证据，模拟远端写入为零。 |
| A07 | 通过。常规打包、Agent 契约和四目标 VSIX 静态验证通过。 |
| A08 | 定位到 Windows RC0 发行包的原生 Unicode 路径处理，可独立复现。保留原生失败门禁。 |
| A09–A10 | 四包哈希与同一 Manifest 一致。两个 macOS 架构和 Ubuntu x64 通过最终 LSP 与 VSIX 运行验收。最终 Windows 运行证据 `not-run`，四目标联合运行验收未达标。 |
| A11 | 通过。缺身份退出 2，远端不完整和身份错配阻断。生产身份仍待确认。 |
| A12 | 通过。远端 Tag、分支、GitHub Release 和两个市场写入均为零。 |

## 简短操作手册

1. 在 Windows x64 上用 Git for Windows 和 Node 24 执行 `npm ci`、`npm run test:release`、`npm run test:assembly`。核对 staging 冻结、回退和失败用例全部通过。
2. 在同一 Windows 主机设置 `SCAD_OPENSCAD_EXECUTABLE` 为经哈希核验的候选 CLI，设置 `SCAD_REQUIRE_CLI=1`。运行 `node scripts/customizer-windows-environment-probe.mjs <openscad.exe> <probe.json>`，然后分别执行 `npm run test:libraries` 与 `npm run test:cad:real`。两项原生门禁都通过后再解除 Unicode 阻断。
3. 把整个工件目录原样复制到目标主机，按下列命令生成目标运行证据。Node 和 VS Code 都需要以该目标架构运行，可用 `node -p "process.platform + '-' + process.arch"` 检查 Node。在 Linux 无显示环境用 `xvfb-run -a` 启动验证。

```text
npm run release:verify -- --plan <dir>/release-plan.draft.json --artifacts <dir>/release-artifacts.json --vscode-executable <Code> --smoke-out <dir>/runtime-<target>.json
```

4. 核对运行报告中的 `artifactsSha256` 与对应目标 `sha256`，确认 `compile`、`binary-header`、`cli-smoke`、`lsp-stdio`、`vsix-install` 均为 `pass`。以后用经确认的双市场身份运行 `npm run release:version:status -- --publisher <verified-publisher> --json`，检查两市场历史完整，再用正式 Plan 重复验包与 dry-run。 [发布手册](release-system.md)
