# Interactive website workbench

This is a **single editor group** inside an isolated same-origin iframe, not a full VS Code instance. Dark Modern palette and Codicons mirror VS Code's classic workbench; Monaco is the actual editor core. The source view is read-only with a small Monarch tokenizer (not the desktop TextMate grammar or language server).

The 3D view imports the extension's actual `App` and `Bridge`, including the underlying Stage, widgets, toolbar, options and panels. It feeds the supplied STL through the existing message contract. The Browser adapter owns only asset loading and supported host actions. It intentionally does not pretend to run OpenSCAD, native clipped topology, slicer, CLI, library management or AI. Local mesh measurement uses the real renderer. Switching editor modes retains the same mounted Preview, pauses it while hidden, and lays out Monaco on return.

## Build / review

From the repository root:
```sh
npm ci --ignore-scripts
node site/build-demo.mjs
node site/build-og.mjs
node --test site/demo.test.mjs site/seo.test.mjs
python3 -m http.server 8000 --directory site
```

Open http://localhost:8000/ (not file://). On desktop compare the Dark Modern workbench against the extension in VS Code. Click the editor title action to reopen the same SCAD file as text or preview; click cheese.stl in Explorer for the actual mesh view. Check browser GPU initialization, orbit, zoom, camera projection, wireframe, grid, measurement, tooltips and side panel, narrow width, switching and page visibility.

Generated bundles live in `site/demo/generated/` and are built on every Pages run from the same locked dependencies as the extension. They are not committed. No CDN at runtime.

## Research / possible next step

- [VS Code UI](https://code.visualstudio.com/docs/editing/getting-started/userinterface)
- [Dark Modern theme](https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/dark_modern.json)
- [Monaco](https://github.com/microsoft/monaco-editor)
- [CodinGame VS Code API](https://github.com/CodinGame/monaco-vscode-api) — a genuine browser workbench candidate for a separate full-screen playground, not required by the landing page.
- [VS Code web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions) — browser extensions cannot run desktop native processes.
- [Cursor](https://cursor.com/) — product demo interaction reference, not an assertion about its underlying implementation.

PR CI builds the actual bundles and runs a Playwright Chromium smoke test under `/scad-ai-ide/`. It waits for the real renderer's `frameReady`, switches to Monaco, switches back without remounting, and saves screenshots. Desktop VS Code comparison, Safari/Firefox, and touch/GPU visual acceptance remain manual checks.
