---
name: openscad-libraries
description: Search, install exact OpenSCAD library versions, restore project dependencies, verify or repair global sources, or safely clean library storage through SCAD AI IDE.
---
1. Call `scad_ai_ide_libraries_projectState` to discover projects. Always supply an explicit returned project path for changes; GUI selection is not an Agent default.
2. Call `scad_ai_ide_libraries_search` for registry metadata and exact versions. Paginate; query an exact library ID for detail. `scad_ai_ide_libraries_refresh` refreshes the registry independently of panels. Surface offline/error status.
3. Call `scad_ai_ide_libraries_install` with project, ID and exact version label, then read project state. Confirm manifest/lock and mount integrity. Files are `.scad/dependencies.json` and `.scad/dependencies.lock.json`.
4. `scad_ai_ide_libraries_restore` honors pinned lock commits; `scad_ai_ide_libraries_remove` removes project dependency without deleting global sources. Do not edit managed files or stores by hand.
5. Read `scad_ai_ide_libraries_globalState` for cache keys/references; verify using `scad_ai_ide_libraries_verify`, repair exact key using `scad_ai_ide_libraries_repair`. File inventory verification is not independent supply-chain authenticity.
6. Cleanup requires `scad_ai_ide_libraries_cleanupPlan` (key OR mode unused/all), review impact and protections, then `scad_ai_ide_libraries_cleanupExecute` with its short-lived planId. The human must independently confirm; no JSON field grants approval. “all” can remove sources used by projects; manifests/locks survive for Restore. Unknown projects cannot be checked. Replan after expiry/state changes.
7. Read operation status or request cancellation with `scad_ai_ide_operation_status` / `scad_ai_ide_operation_cancel`. Do not claim success after partial failure/cancellation.

Examples: “在当前项目安装指定 OpenSCAD Library 版本并检查 lockfile。” “Preview unused global library cleanup without deleting anything.”


Search results include the same version labels, layout/installability errors and cached flags as the GUI. To cancel the current library task, including one started from the GUI, use `scad_ai_ide_operation_cancel` with `{"domain":"libraries"}` and re-read state; cancellation is cooperative. For an exact tracked Agent operation use its ID instead. Do not claim a cancellation request has completed a critical filesystem transaction.
