---
name: openscad-runtime
description: Detect, install, select or repair the selected OpenSCAD CLI runtime in SCAD AI IDE, including offline archives and extension-host executable paths.
---
1. For “which CLI is in use?” or “which OpenSCAD versions are installed?”, call `scad_ai_ide_runtime_state` with `{}`. Read `data.state.activeRuntime.version` and `command.executable` for the selected CLI; this full object is returned even outside the installed page. Read `data.state.runtimes.items` for detected installations, following `hasMore` / `nextOffset` until all pages are read. Check `discovery.status`, `configuredError` and diagnostics; null activeRuntime means none selected, not necessarily no installations. Discovery/probing requires Workspace Trust. These are extension-host installations (remote host when applicable), not an exhaustive client-machine filesystem scan. Use `scad_ai_ide_runtime_refresh` if discovery is stale, then read state again. `runtime_builds` lists downloadable releases, not installed versions. Require workspace trust for changes.
2. To change an existing installation, use `scad_ai_ide_runtime_select` with an exact observed ID. Otherwise call `scad_ai_ide_runtime_builds`, paginate and filter channel Stable or Snapshot. Never invent versions or assume the first snapshot is a stable release.
3. Install the selected exact build ID using `scad_ai_ide_runtime_installBuild`. For offline installation, use `scad_ai_ide_runtime_installArchive` with an absolute extension-host path. `scad_ai_ide_runtime_addExecutable` probes a custom executable/app and selects it.
4. Query state again, select the installed runtime ID, and verify the actual active version/path. GUI and Preview share that selection. A failed/cancelled tool is not a completed install.
5. For removal use `scad_ai_ide_runtime_remove`; only managed installations qualify and the human must confirm. Never delete paths manually.
Use `scad_ai_ide_operation_status` to observe running/terminal operations and `scad_ai_ide_operation_cancel` for cooperative cancellation. Critical sections may finish before cancellation takes effect.

Examples: “查看当前 OpenSCAD Runtime，并安装/切换到最新可用的稳定版本。” “Use this offline OpenSCAD archive on the remote host.”


GUI parity checklist: state gives the active CLI and installed/downloaded inventory; select switches an observed ID; builds lists online releases and `refresh:true` forces Available Refresh; installBuild downloads the observed exact build; installArchive imports an offline archive; addExecutable registers a local CLI; remove deletes only managed installations with real confirmation; refresh mode=installed matches Installed-tab refresh. Do not treat loading a cached online list as a refresh. Build rows include installed flags. Installation does not imply activation: select explicitly and read back the active CLI. Check postconditions and errors.

To stop an installation started from either GUI or Agent, call `scad_ai_ide_operation_cancel` with `{"domain":"runtime"}`. For a specific tracked Agent operation use `{"id":"<observed operation ID>"}` instead. Choose exactly one; cancellationRequested is a request, not terminal completion. Re-read Runtime state until installing clears.
