---
name: openscad-runtime
description: Detect, install, select or repair the selected OpenSCAD CLI runtime in SCAD AI IDE, including offline archives and extension-host executable paths.
---
1. Call `scad_ai_ide_runtime_state`, then `scad_ai_ide_runtime_refresh` if discovery is stale. Require workspace trust for changes.
2. To change an existing installation, use `scad_ai_ide_runtime_select` with an exact observed ID. Otherwise call `scad_ai_ide_runtime_builds`, paginate and filter channel Stable or Snapshot. Never invent versions or assume the first snapshot is a stable release.
3. Install the selected exact build ID using `scad_ai_ide_runtime_installBuild`. For offline installation, use `scad_ai_ide_runtime_installArchive` with an absolute extension-host path. `scad_ai_ide_runtime_addExecutable` probes a custom executable/app and selects it.
4. Query state again, select the installed runtime ID, and verify the actual active version/path. GUI and Preview share that selection. A failed/cancelled tool is not a completed install.
5. For removal use `scad_ai_ide_runtime_remove`; only managed installations qualify and the human must confirm. Never delete paths manually.
Use `scad_ai_ide_operation_status` to observe running/terminal operations and `scad_ai_ide_operation_cancel` for cooperative cancellation. Critical sections may finish before cancellation takes effect.

Examples: “查看当前 OpenSCAD Runtime，并安装/切换到最新可用的稳定版本。” “Use this offline OpenSCAD archive on the remote host.”
