# SCAD AI IDE 发布手册

版本管理、构建和发布可以独立执行。版本管理生成 `release-plan.draft.json`，Git annotated tag 持久化冻结 Plan 和 SHA-256，Builder 交付 VSIX 与 `release-artifacts.json`，Publisher 核验原始 VSIX 并记录逐市场、逐目标状态。

## 环境

- 安装 Node.js 22.15 或更新版本、npm、Git 和 Rust。运行 `npm ci` 安装锁定的 VSCE 4.1.1 和 OVSX 1.4.0。Rust 依赖来自 LSP 子模块的 `Cargo.lock`。
- 开发时用 `git submodule update --init` 初始化三个子模块。Builder 在隔离 checkout 中使用源码提交的 gitlink 和 npm lockfile。
- 用 `rustup target add aarch64-apple-darwin x86_64-apple-darwin x86_64-unknown-linux-gnu x86_64-pc-windows-msvc` 安装标准库。macOS 需要 Xcode Command Line Tools。Linux 交叉编译需要 Zig 和 cargo-zigbuild，Windows 交叉编译需要 cargo-xwin、LLVM 的 clang-cl 和 lld-link，以及 MSVC SDK。固定并记录实际工具版本。Windows 和 Linux 也可在对应目标主机使用 Cargo。交叉链接需要验证 Tree-sitter 的 C 依赖和系统 ABI。 [cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild) · [cargo-xwin](https://github.com/rust-cross/cargo-xwin)

| VSIX 目标 | Rust Triple | Apple Silicon 上的 Cargo 子命令 |
| --- | --- | --- |
| darwin-arm64 | aarch64-apple-darwin | `build` |
| darwin-x64 | x86_64-apple-darwin | `build` |
| linux-x64 | x86_64-unknown-linux-gnu | `zigbuild` |
| win32-x64 | x86_64-pc-windows-msvc | `xwin build` |

## 确定并预留版本

~~~sh
npm run --silent release:version:status -- --publisher "$SCAD_PUBLISHER" --json
npm run --silent release:version:resolve -- --channel preview --change fix --json
~~~

由维护者确认 VS Code Marketplace Publisher 与 Open VSX Namespace 是同一个实际可用的标识，再将该标识传给 `--publisher` 或写入 `package.json`。GitHub 所有者名称不能代替市场身份。缺少配置时，状态命令返回 `configurationMissing`、配置指引和退出码 2。任一远端历史查询不完整时，状态命令返回退出码 3，版本预留保持阻断。`--offline <file>` 可读取包含 `gitTags`、`vscode`、`openvsx` 三个数组的测试夹具，市场条目采用 `{version,target,preRelease}`。夹具创建的草案携带 `offlineMock`，空数组可用于练习首次发布。

Preview 使用奇数 Minor，Stable 使用偶数 Minor，首轮分别从 `0.1.0` 和 `0.2.0` 开始。Preview 用 `--cycle continue` 增加 Patch。用 `--cycle promote --approve` 将经批准的 Preview 提升到下一偶数 Minor，或用 `--cycle next --approve` 从 Stable 开启下一 Preview。Stable 修复使用 `--cycle hotfix --base <stable-version>`，并将 `--maintenance-ref` 指向维护分支完整引用，例如 `refs/heads/release/0.2`。源码须在该 Stable Tag 之后并在维护分支可达。Major 切换使用 `--cycle major --major <number> --approve`。更高的 Stable 发布后，VS Code 可能将 Preview 用户升级到 Stable。 [VS Code 发布规范](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

把示例路径中的版本替换为 Resolver 的结果。所有命令均支持 `--help`。

~~~sh
npm run release:version:plan -- --publisher "$SCAD_PUBLISHER" --channel preview --change fix \
  --commit "$(git rev-parse HEAD)" --out releases/0.1.0/release-plan.draft.json
npm run release:version:verify -- --publisher "$SCAD_PUBLISHER" --plan releases/0.1.0/release-plan.draft.json
npm run release:version:reserve -- --plan releases/0.1.0/release-plan.draft.json --dry-run
~~~

经明确授权后，为预留命令加上 `--apply --confirm-release scad-ai-ide-v0.1.0 --publisher "$SCAD_PUBLISHER" --out releases/0.1.0/release-plan.json`。维护版本使用同一个 `--maintenance-ref`。Git 使用正常的远端身份认证。预留对远端 Tag 执行一次非强制创建。Tag 的消息首行记录 Plan SHA-256，空行后是完整的 canonical JSON。本地 `release-state.json` 记录预留结果。若远端已创建 Tag 且本地保存失败，以同一草案重跑。若另一个 Plan 已占用 Tag，保留既有 Tag 并停止。维护者需另行核对私有 GitHub 草稿。

## 构建与验包

~~~sh
npm run release:build -- --plan releases/0.1.0/release-plan.json
npm run release:verify -- --plan releases/0.1.0/release-plan.json \
  --artifacts releases/0.1.0/release-artifacts.json
~~~

本地开发可对草案增加 `--allow-unreserved`，再通过可重复的 `--target` 缩小构建范围。全部计划目标验包成功后才会生成正式的 Artifact Manifest。子集构建会保留已验包的 VSIX。之后构建全套时，可用新的 `--out` 输出目录。已有同名文件只有在字节完全一致时才可复用。

Builder 使用隔离的 detached checkout。对旧提交，Builder 会将当前发布钩子和必需辅助文件覆盖到临时 staging。原有 `npm run package` 负责 Agent 校验、类型检查、Lint、生产 bundle 和许可证。打包钩子在 staging 中校验已构建资产。常规开发打包继续先编译宿主 LSP。开发 Skill 存放在 `.agents/skills/` 并从 VSIX 排除。

在每个目标系统，使用同一份 Plan、Manifest 和整套 VSIX，指向该系统实际安装的 VS Code 可执行程序。命令使用独立的 VS Code 用户配置和扩展目录。

~~~sh
npm run release:verify -- --plan releases/0.1.0/release-plan.json \
  --artifacts releases/0.1.0/release-artifacts.json \
  --vscode-executable "$SCAD_CODE_EXECUTABLE" --smoke-out releases/0.1.0/runtime-arm64.json
~~~

ARM Mac 的可执行程序位于 `Visual Studio Code.app/Contents/MacOS/Code`。如果 Electron 在沙箱中返回 SIGABRT，在允许启动桌面应用的环境重试。Smoke 只运行当前宿主目标，其他平台需在相应主机上验证。报告通过 Manifest 和 VSIX 的 SHA-256 绑定。ABI 最低版本仍需在要支持的系统上验证。

## 发布与恢复

~~~sh
npm run release:publish -- --plan releases/0.1.0/release-plan.json \
  --artifacts releases/0.1.0/release-artifacts.json --dry-run
npm run release:reconcile -- --plan releases/0.1.0/release-plan.json \
  --artifacts releases/0.1.0/release-artifacts.json
~~~

默认 dry-run 校验本地交接，`--query` 或 `release:reconcile` 查询两个商店。经明确授权的 `--apply` 需要 `--confirm-release <release-id>`、已配置的发布者、匹配远端 Tag 的冻结 Plan、完整静态验证和每目标运行证据。可重复传入 `--smoke <runtime.json>` 补充各主机报告。VSCE 和 OVSX 分别从环境读取 `VSCE_PAT` 和 `OVSX_PAT`，并先执行各自的 `verify-pat`。发布工具传输已经验证的 VSIX。 [VSCE 发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) · [Open VSX CLI](https://github.com/eclipse-openvsx/openvsx/blob/main/cli/README.md)

`--market` 选择 `vscode|openvsx|all`，`--target` 可缩小本次上传范围。整体状态覆盖两个市场和 Plan 的全部目标。遇到部分发布时保留 Plan、Manifest、原 VSIX 与发布状态。每次上传前先将尝试写入状态。任何曾开始上传的目标再次查无版本时都会阻断，未确认结果为 `upload-outcome-unconfirmed`，已获上传响应或曾匹配字节为 `remote-version-disappeared`。查询失败、下载失败及字节或通道冲突同样阻断。只有从未尝试上传且市场确认缺失的目标可由获授权的重跑提交；已有匹配工件直接跳过。

`release:reconcile` 只读核对，输出 `manualReviewRequired`，其中包含 release ID、市场、目标、原 VSIX SHA-256、历史尝试次数和最后状态。人工核对市场后台及 API、原始上传日志和包哈希。市场包可下载后重跑对账，匹配会显示 `present-matching`，获授权的后续运行会写入 `verified`。长期不可见且市场管理员确认从未接收时，任何单项目恢复都需另行审计与授权，保留原状态记录。

| 退出码 | 说明 |
| --- | --- |
| 0 | 操作成功 |
| 2 | 参数、契约或用户配置错误 |
| 3 | 远端、网络或身份状态无法确认 |
| 4 | 版本、预留或工件冲突，或历史上传结果尚待核实 |
| 5 | 构建、存储或本地验证失败 |
| 6 | 上传未完成或仅部分完成 |

用 `npm run --silent <script> -- --json` 获取单个 JSON 对象。构建与运行日志写入 stderr，可在 shell 中单独重定向。用 `npm run test:release` 执行离线回归。

## 正式发布前检查

- 确认双市场身份归属，用只读状态查询确认 Git 和两个市场的历史均完整。凭据通过环境变量或系统凭据存储注入。
- 确认三系统 CI 及 Windows 原生 Library/CAD 门禁通过。Windows RC0 的复现、证据与上报入口见 [Windows Unicode 排障](customizer/windows-unicode-closeout.md)。
- 使用同一份冻结 Plan 和 Artifact Manifest 核验四份原始 VSIX。对每个目标收集 Manifest 和 VSIX 哈希一致的运行报告，确认 LSP CLI、stdio、VSIX 安装和 Extension Host 激活全部通过。
- 在计划支持的最低系统上核验 Linux glibc、Windows MSVC Runtime 与 macOS 系统版本。尚无对应运行报告的目标仍待验收。
- 审阅 dry-run 的八项市场操作和只读对账。有人工核实项时先按上文处理。取得明确授权后再进行实际预留或上传。

## 首轮实现验证

基线为 `9b4fcd3301defa86a10f311f2a52fc42e7767878`。实测工具链为 Rust 1.100.0、cargo-zigbuild 0.24.1、Zig 0.17.1 和 cargo-xwin 0.23.1。Windows 交叉构建使用 MSVC SDK 和本地适配的 Rust LLD。四目标离线 Preview 工件与 Manifest 保存在本次工作区的 `releases/smoke-four-targets/`。另用独立草案验证了 macOS x64 Stable 包的通道标记。

| 目标 | 编译、二进制头及 VSIX 静态校验 | LSP CLI 和 stdio | VSIX 安装及扩展激活 |
| --- | --- | --- | --- |
| darwin-arm64 | 通过 | 原生通过 | 原生通过 |
| darwin-x64 | 通过 | Rosetta 通过 | Rosetta x64 扩展宿主通过 |
| linux-x64 | 通过 | 未运行 | 未运行 |
| win32-x64 | 通过 | 未运行 | 未运行 |

四目标 Manifest 的离线发布 dry-run 生成八项操作。Git 预留并发、模拟上传、断线对账和恢复覆盖在 `npm run test:release` 中。真实发布仍需正式市场身份和 Linux、Windows 的运行证据。
