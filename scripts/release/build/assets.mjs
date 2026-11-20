export const releaseAssets = [
    'dist/extension.js', 'dist/preview.js', 'dist/markdown-preview.js', 'dist/markdown-owned.js',
    'dist/review-view.js', 'dist/customizer.js', 'dist/panel-scrollbar.js',
    'dist/mesh-topology-worker.mjs', 'dist/mesh-verification-worker.mjs',
    'dist/assembly-verification-worker.mjs', 'dist/review-geometry-worker.mjs',
    'dist/manifold.wasm', 'dist/onig.wasm', 'dist/codicons/codicon.css', 'dist/codicons/codicon.ttf',
    'licenses/saxes/LICENSE', 'licenses/robust-predicates/LICENSE', 'server/LICENSE-APACHE',
    'LICENSE',
]

export const releaseExcludes = [
    '.agents/**', 'site/**', 'releases/**', '.release-work/**', 'docs/release-system.md',
    'docs/specs/**', '**/.env', '**/.env.*', '**/.git', '**/.git/**', '**/.npmrc',
]
