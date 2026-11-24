# Native Workbench product demo

The outer iframe runs the actual Code-OSS classic Workbench via CodinGame Monaco VS Code API 38.1.3. No handwritten activity bar, Explorer, editor tabs or status bar. It opens a read-only virtual cheese-demo folder and registers the shared Preview as a native custom editor pane via CodinGame's registerEditorPane/registerEditor API. A tiny local extension contributes the real OpenSCAD TextMate grammar and editor-title commands. The Preview is mounted in an isolated same-origin iframe so its WebView CSS and GPU lifecycle do not interfere with Workbench CSS. It uses the existing App, Bridge, Stage, Toolbar and Options. No native OpenSCAD compiler, LSP, AI, terminal backend or external tools. The native pane is not the desktop CustomTextEditorProvider; this avoids the nested VS Code webview service-worker/origin requirements on GitHub Pages. Switching replaces the editor and remounts Preview. Browser and OS chrome can differ from desktop VS Code.

Build from the repository root:
```sh
npm ci --ignore-scripts
npm install --prefix tools/pages-workbench --ignore-scripts --no-audit --no-fund
node site/build-demo.mjs
node site/build-og.mjs
node --test site/demo.test.mjs site/seo.test.mjs
npx playwright install chromium
node --test site/demo/browser.test.mjs
```

The Workbench dependencies are isolated from the desktop extension. Direct package versions are pinned; first CI generates the separate lockfile as an artifact for subsequent check-in. Production output lives in site/demo/generated; no node_modules are published. Vite uses relative URLs for the project Pages prefix. The browser test checks actual Workbench, actual renderer first frame, native editor title actions, source contents and return to Preview. Review screenshots for desktop/mobile fidelity before merge. The preview-only fallback is available on boot failure and is not a mock Workbench.

API reference: https://github.com/CodinGame/monaco-vscode-api/tree/v38.1.3/demo/src
