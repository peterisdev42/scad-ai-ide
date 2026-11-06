---
name: scad-ai-ide-diagnostics
description: Diagnose SCAD AI IDE runtime, library and GitHub status, or inspect bounded redacted disposable caches only when the extension runs in Development mode.
---
1. Query `scad_ai_ide_more_githubStatus`, `scad_ai_ide_runtime_state` and `scad_ai_ide_libraries_projectState`. Report observed state and actionable errors. GitHub status never returns credentials.
2. If the user needs GitHub authorization, use `scad_ai_ide_more_authorizeGitHub`; the user completes the actual VS Code Accounts flow. Never request, read or print tokens.
3. Call `scad_ai_ide_development_status`. When disabled, stop cache diagnostics and explain Development mode is required; do not suggest bypassing that guard.
4. In Development mode, `scad_ai_ide_development_listCaches` returns bounded metadata; inspect only a needed exact ID using `scad_ai_ide_development_inspectCache`. Preview is redacted/capped but may still contain personal information; do not dump bulk state.
5. `scad_ai_ide_development_clearCaches` takes exactly one id, scope or all=true and independently asks the human to confirm. Managed runtimes, exporter binaries, library sources and reference indices are not disposable caches. Report partial failures and re-read metadata afterward.

Examples: “检查 GitHub 连接状态；在开发模式检查缓存，但不要泄露任何敏感值。” “Explain why the cached registry appears offline without deleting dependencies.”
