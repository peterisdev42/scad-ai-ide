# Native Workbench product demo

The outer iframe runs the actual Code-OSS classic Workbench via CodinGame Monaco VS Code API 38.1.3. No handwritten activity bar, Explorer, editor tabs or status bar. It opens a read-only virtual cheese-demo folder and registers the shared Preview as a native custom editor pane via CodinGame's registerEditorPane/registerEditor API. The native left Activity Bar remains visible but is inert (including Accounts and Manage); Explorer and the editor-title commands remain interactive. A tiny local extension contributes the real OpenSCAD TextMate grammar and editor-title commands. The Preview is mounted in an isolated same-origin iframe so its WebView CSS and GPU lifecycle do not interfere with Workbench CSS. It uses the existing App, Bridge, Stage, Toolbar and Options. The website build runs OpenSCAD CLI on the only example file, cheese.scad, generating internal 3MF geometry and source hash/color metadata. The browser runs no compiler, LSP, AI, terminal backend or external tools. The outer page controls Light Modern / Dark Modern; the Workbench theme service sends actual colors to the Preview iframe without remounting. The native pane is not the desktop CustomTextEditorProvider; this avoids the nested VS Code webview service-worker/origin requirements on GitHub Pages. Switching replaces the editor and remounts Preview. Browser and OS chrome can differ from desktop VS Code.

Build from the repository root (install OpenSCAD CLI 2021.01 or newer; set OPENSCAD_CLI if needed):
```sh
npm ci --ignore-scripts
npm install --prefix tools/pages-workbench --ignore-scripts --no-audit --no-fund
node site/build-demo.mjs
node site/build-og.mjs
node --test site/demo.test.mjs site/seo.test.mjs
npx playwright install chromium
node --test site/demo/browser.test.mjs
```

The Workbench dependencies are isolated from the desktop extension. Direct package versions are pinned; first CI generates the separate lockfile as an artifact for subsequent check-in. Production output lives in site/demo/generated; no node_modules are published. Vite uses relative URLs for the project Pages prefix. The browser test checks actual Workbench, actual renderer first frame, native editor title actions, source contents, both website themes and return to Preview. Review screenshots for desktop/mobile fidelity before merge. The preview-only fallback is available on boot failure and is not a mock Workbench.

API reference: https://github.com/CodinGame/monaco-vscode-api/tree/v38.1.3/demo/src

The embedded Workbench must not take focus from the marketing page during initialization. The homepage frame and inner workbench root are inert during boot. A shared focus-guard side effect runs before both Code-OSS and nested Preview initialization, only inside the homepage demo: passive programmatic focus and reveal calls are suppressed before genuine user input and while the frame is not focused; active element focus uses preventScroll. Native pointer and keyboard interaction remains available after boot. Standalone Preview, the marketing page and the desktop IDE are unchanged. The real browser regression verifies first visit and reload through the rendered Preview ready state, including transient scroll events, before any test-driven interaction.

## Production asset cache

After building the demo and OG image, run `node site/build-pages.mjs`. The publishable artifact is `.build/pages`; source modules remain separate. The release directory is derived from the exact runtime contents and retains relative paths for the real Workbench. The homepage opens Workbench directly. A scoped optional service worker lazily caches successful immutable Demo GET responses in Cache Storage, without caching homepage/SEO data or prefetching every bundle. Existing clients finish with their old worker; obsolete owned release caches are cleaned on activation. The browser test measures real cold/warm readiness and HTTP request counts with HTTP caching disabled and verifies critical assets in Cache Storage. The model color is embedded at build time, eliminating a serial metadata request. The Preview HTML preloads its module and model. No desktop extension changes or persistent GPU state are implied.
