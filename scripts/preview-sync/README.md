# Preview 手动双向同步

在 SCAD AI IDE 插件根目录执行。同步工具、测试和 `.preview-sync/` 基线均归本插件管理，不依赖 Builder。两份插件继续独立构建、独立运行；只有显式调用下面的命令时才同步。工具不拉取上游，不提交 Git，也不启动 watch。

## 常用命令

```sh
# 查看两边相对于最近同步基线的改动
npm run preview:sync -- status

# Preview 上游拉取、合并完成后，生成导入 IDE 的计划（不改源码）
npm run preview:sync -- to-ide

# IDE 内完成修改后，生成反向导回 Preview 的计划（不改源码）
npm run preview:sync -- to-preview

# 审阅生成的计划和合并文件后，应用指定计划
npm run preview:sync -- apply <计划ID>
```

确定要应用时，也可直接运行：

```sh
npm run preview:sync -- to-ide --apply
npm run preview:sync -- to-preview --apply
```

`--apply` 仅在整个计划无冲突时写入。一项冲突也会阻止整批应用，源码和同步基线均保持不变。默认命令只生成审阅材料；不要求两份仓库先提交，也不会把旧的 IDE 宿主适配当成新改动反向导出。

默认使用相邻的 `../vscode-openscad-preview` 仓库。独立克隆或更换目录时，可通过环境变量指定外部仓库（相对路径以本插件根目录为基准）：

```sh
PREVIEW_SYNC_PREVIEW_ROOT=/path/to/vscode-openscad-preview npm run preview:sync -- status
```

所有同步命令使用同一设置。外部路径不写入共享基线；更换路径应指向同一 Preview 项目的对应工作副本。缺少外部仓库时会拒绝同步，不影响插件构建和运行。

依赖：Git、Node.js，以及本插件的锁定依赖（在插件根目录执行 `npm ci`）。规范化使用其 Prettier，以消除两边缩进、引号和分号的差异，写回时遵守目标仓库的格式配置。

## 同步范围

映射定义在 [config.mjs](config.mjs)：

| Preview                               | SCAD AI IDE                                   |
| ------------------------------------- | --------------------------------------------- |
| `src/webview/**`                      | `src/features/preview/webview/**`             |
| `src/shared/**`                       | `src/features/preview/shared/**`              |
| `src/extension/**`，排除下列文件      | `src/features/preview/extension/**`           |
| `src/test/viewCube.test.ts`           | `src/test/preview/viewCube.test.ts`           |
| `src/test/navigationAndPlate.test.ts` | `src/test/preview/navigationAndPlate.test.ts` |

两个共享测试的相对视口导入路径可逆转换；映射目录中的新增文件、删除文件、二进制资源也会检测。重命名表现为删除旧文件、增加新文件。工具仅同步文件内容，不同步执行权限，不跟随符号链接。

双方扩展启动入口、manifest、依赖/锁文件、构建配置及 IDE 的 Runtime/Customizer 本体保持各自维护。Preview 的 `src/extension/index.ts`、基于独立解析器的 `ScadParser.test.ts` 不复制；IDE 的 `registerPreview.ts` 和 IDE 专属测试也不复制。部分配置文件变更会单独提示，提示不阻止源码同步，配置内容不会被覆盖；检查清单见 `config.mjs` 的 `watch`，不是任意路径的自动依赖分析。

**映射范围内的宿主服务仍然不同**：例如 `ScadClient`、`ScadSession`、`ScadParser`。工具使用三方合并保留已存在的差异，不保证所有宿主改动都可直接移植。导入新的 IDE 专属依赖、消息协议或上游依赖后，仍需根据双方接口检查、适配并构建验证。

如果已经人工处理好提示的依赖、配置或入口变化，可运行：

```sh
npm run preview:sync -- ack-host
```

这只确认配置提示，不改变源码同步基线。该命令会使旧计划失效，应用前重新生成计划。

## 冲突与审阅

计划保存在 `.preview-sync/plans/<ID>/`，由命令打印路径。`plan.json` 的每个条目对应带编号的文件：

| 文件              | 内容                                                       |
| ----------------- | ---------------------------------------------------------- |
| `<N>.source`      | 本次来源的当前内容                                         |
| `<N>.base`        | 来源上次同步的基线                                         |
| `<N>.target`      | 目标工作区当前内容                                         |
| `<N>.target-base` | 目标上次同步的基线                                         |
| `<N>.merged`      | 拟写入目标的结果；文本冲突含 diff3 标记                    |
| `<N>.baseline`    | 仅接收本次来源改动后的目标基线，保留未导出的目标改动可见性 |

不存在的内容不生成文件；所有审阅材料中的 TypeScript 都使用统一格式及 IDE 侧测试导入路径。它们是计划材料，不应直接整目录拷贝到源码。

解决冲突：

1. 在 `<N>.merged` 中完成合并，去掉 `<<<<<<<`、`|||||||`、`=======`、`>>>>>>>` 标记。
2. 在 `plan.json` 将该条目的 `resolved` 设为 `true`。
3. 如果 `same: false` 且 `conflicts` 包含 `baseline`，还需解决 `<N>.baseline`：仅保留本次导入和既有宿主适配，不混入目标工作区尚未反向导出的改动。`same: true` 时工具直接使用已解决的 `.merged` 更新目标基线，无需再改 `.baseline`。
4. 对新增/删除、二进制冲突，明确选择保留哪一版内容。要删除目标，将 `result` 设为 `delete`；目标有独立改动时，基线删除选择用 `baselineResult: "delete"`。保留文件时相应字段使用 `file`，编辑对应文件。
5. 运行 `npm run preview:sync -- apply <ID>`。

也可把某条目的 `skip` 设为 `true`，先应用其他条目；被跳过的文件基线不变，下次仍提示待同步。不要修改计划内的路径、哈希、方向、`same` 或来源快照。

生成计划后，若任一涉及的源码文件被修改，或其他同步已更新基线，应用会拒绝；保留审阅结果，重新生成并检查新计划。避免在应用期间由编辑器、格式化器或构建任务同时写源码。写入前统一检查输入；普通写入错误会回滚已写文件。进程被强杀、断电等情况仍以 Git diff 和文件系统实际状态为准。

## 基线如何避免反向污染

`.preview-sync/state.json` 和 `.preview-sync/objects/` 分别保存**两边各自的基线**及内容。第一次建立时就记录当前已有的宿主差异，不假定两边字节相同。

例如外部视口有新功能，内部同时有未导出的测量修改：导入时合并两项改动，但只推进内部基线中来自外部的新功能；测量修改继续显示为内部待同步，随后反向导出。不会因导入一次就把内部未导出的修改隐藏掉。

这组初始基线已随本次实现建立，不需要再次 `init`。`init` 只允许首次运行，已有基线时拒绝覆盖。**把 state 和 objects 与对应两份源码一起纳入版本控制**，在克隆或切换分支后保持匹配；plans、锁和临时合并目录已忽略。同步完成后，分别提交两份代码仓库的变更，并在本插件仓库提交更新的基线；若使用 Builder，再更新其子模块引用。

请勿删除基线后重新 init 来清除待同步状态，否则那些改动会被重新认定为已有适配。映射配置、同步协议或格式化器版本变化时工具会拒绝继续，需有意识地迁移历史基线；不能简单重新初始化来替代迁移。

## 验证

```sh
npm run test:preview-sync

# 导入 IDE 后
npm run package
npm test

# 反向导回 Preview 后
cd /path/to/vscode-openscad-preview
npm run types
npm run lint
npm run compile
npm run test:view-cube
npm run test:viewport
```

同步工具测试包含双向往返、已有宿主差异、双方未提交改动、三方冲突、过期计划、增删与二进制资源、回滚、格式规范化、测试导入路径转换及缺失仓库保护。视口交互、实际 OpenSCAD 导出和切片软件需按相应插件的宿主测试另行验证。

从 Builder 迁移时保留了原有基线和对象，仅迁移位置及配置指纹；迁移前生成的审阅计划因基线摘要变化而失效，需重新生成。真实双仓库集成测试需要外部 Preview 工作副本，缺失时跳过；其余测试在独立插件内运行。
