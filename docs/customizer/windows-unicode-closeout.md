# Windows Unicode 原生 CLI：两轮复现与暂缓修复

2026-11-11。状态：**FAIL；本轮跳过继续猜测性修复**。Windows 发布门禁仍未通过，没有删除原集成测试，也没有修改外部 CLI Builder 仓库。

实际 Windows runner：`windows-2025`，image `win25-vs2026 / 20261103.298.1`。两轮均使用经过 archive SHA256 校验的 OpenSCAD `2026.11-RC0`，可执行文件 SHA256 `d1c8cc1b86a8b08794429892d1247221831e19f00911560496abed5b5d010a01`。

- [第一轮](https://github.com/peterisdev42/scad-ai-ide/actions/runs/43001611736)：21 个诊断探针，11 PASS / 10 FAIL。
- [第二轮](https://github.com/peterisdev42/scad-ai-ide/actions/runs/43002292201)：相同 21 个结果与退出码；不是重新解释一次运行。
- [第一轮原始报告](evidence/closeout-20261111/windows-run1-environment.json)、[第二轮原始报告](evidence/closeout-20261111/windows-run2-environment.json)。两个完整 Library workflow 均为 macOS/Linux 成功、Windows 失败。

| 单一改变 | 实测 |
|---|---|
| ASCII `cube(10)`，无 include | PASS，geometry width=10 |
| 只把 cube 源文件放入 `项目 A`，cwd/output 仍 ASCII | FAIL，native exit `3221226505`，没有 include 或 LibraryEnvironment |
| 只把 STL 输出放入 `项目 A`，source/cwd 仍 ASCII | FAIL，exit 1，原生声称已存在的输出目录不是目录 |
| 只把 cwd 换成 Unicode，source/output 仍为 ASCII 绝对路径 | PASS |
| ASCII 实体库、Junction、copy、symlink | 全部 PASS，真实 geometry width=10 |
| ASCII `OPENSCADPATH`、混合大小写、多目录、实际 LibraryEnvironment 注入 | 全部 PASS |
| 只把库根目录换成中文或非 BMP，source/output/cwd 仍 ASCII | FAIL，找不到真实存在的 include |
| 历史 `项目 A/.scad/lib` 实体 / `项目 B/.scad/lib` Junction | 绝对、相对 search path 均失败，原失败 fixture 保留 |

带引号的 OPENSCADPATH 也失败；它是独立的探索探针，不是支持契约。不能把它与 Unicode 问题混算成新的根因。

**FACT**：失败能在完全没有库管理器、没有 include 的 native 进程重现；仅改 Junction、copy fallback 或环境变量大小写不足以解决。Node 在每个链接实验中实际检查 lstat/stat/realpath；报告保留真实 stderr、signal、退出码、输出 hash、几何宽度及路径 UTF-8 表示。没有根据崩溃数字推断具体 Win32 API。

**尚未知**：没有同一上游 SHA 的第二种独立 Windows build 对照，因此不能区分当前发布包构建设置与 OpenSCAD 上游实现责任。`ANSI/narrow path conversion` 只是 HYPOTHESIS。本轮不把它写成已证实的上游 bug，不用危险的用户源码搬运或全局编码切换掩盖失败。

可用的临时边界：全部相关路径均为 ASCII 的合成项目已实际通过；这不证明任意用户工程可以安全自动迁移。没有在 IDE 中自动搬移项目或重写路径。责任交接对象为 CLI 发布包维护者，需提供独立 Unicode-capable build 或上游最小复现对照后再恢复 Windows gate。

## 可直接转交的最小复现

在 Windows 上保存下面 Node 脚本，再以 `node probe.mjs C:\path\openscad.exe` 执行。不需要 IDE、库、Junction 或任何用户工程。

```js
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const binary = process.argv[2]
const root = mkdtempSync(path.join(tmpdir(), 'scad-unicode-'))
try {
  for (const name of ['ascii', '项目 A']) {
    const dir = path.join(root, name)
    mkdirSync(dir)
    const source = path.join(dir, 'cube.scad')
    writeFileSync(source, 'cube(10);\n')
    const result = spawnSync(binary,
      ['--export-format', 'asciistl', '-o', path.join(root, name === 'ascii' ? 'a.stl' : 'b.stl'), source],
      { cwd: root, encoding: 'utf8', timeout: 30000 })
    console.log({ name, status: result.status, signal: result.signal, stderr: result.stderr })
  }
} finally { rmSync(root, { recursive: true, force: true }) }
```

这是一份本地 issue 草稿；没有代用户发送上游 issue。恢复条件：独立 build 对照、Unicode source/library/output 全部通过，再跑 Library 几何版本切换及两个真实 Windows 完整 PASS。当前不能宣布 W-PASS。
