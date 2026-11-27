# Website design system

The public [Geist Design System](https://vercel.com/geist/introduction) is the design authority. This project implements a local, native HTML/CSS subset, not Vercel's private React component package. Official Geist Sans/Mono are pinned and self-hosted under their original font license. Local sRGB color values and type/material presets follow the public semantics and reference examples, not a guaranteed byte-identical upstream token export. P3 values and unused components are not implemented. The existing project-owned UI glyphs are centralized in an SVG sprite; they are not claimed to be official Geist Icons.

## Layering

- `site/geist/index.css`: single design-system entry.
- `colors.css`: nine ten-step families plus two backgrounds, both themes; semantic aliases. [Color roles](https://vercel.com/geist/colors).
- `fonts.css`, `typography.css`: Geist font faces and named heading, copy, label, button and mono presets. [Typography](https://vercel.com/geist/typography).
- `spacing.css`: local 4px rhythm; `materials.css`: base, small, medium, large, tooltip, menu, modal and fullscreen presets. [Materials](https://vercel.com/geist/materials).
- `grid.css`: responsive 12/8/4 column guides and container; [Grid](https://vercel.com/geist/grid).
- `components.css`: button, badge, code block, collapse, progress and theme switcher; [Button](https://vercel.com/geist/button), [Badge](https://vercel.com/geist/badge).
- `base.css`, `motion.css`: reset, keyboard focus and reduced motion.
- `theme.js`: sole authority; light first even on a dark OS, explicit choice persists and synchronizes across tabs. The native Workbench reads the root data-theme attribute unchanged.
- `stage-fonts.mjs`: verifies WOFF2 and stages original OFL license.

Product-level CSS belongs in `site/styles.css` (layout) or `site/components/` (illustrations). Use semantic color, spacing, type and material tokens rather than ad hoc colors or radii. The embedded real Code-OSS Workbench and Preview keep their native VS Code theme and behavior; do not restyle those as marketing UI. Native HTML stays readable without JS. No React, Next.js, external CDN for UI assets or third-party Geist UI library.

## Acceptance

`node --test site/geist.test.mjs` checks the layer graph, colors, tokens and theme behavior. Existing SEO/demo tests and Chromium browser checks run in CI; screenshots cover website light/dark/mobile and native Preview. CI also runs on website pushes to main (no PR required).

The root remains the sole canonical product page. All eight capability anchors, product manifest, FAQ, llms.txt, sitemap and status qualifications are preserved on the single product page. Illustrations remain illustrative; real desktop screenshots and recorded Agent acceptance are outstanding. The homepage alone loads the shared Umami tracker; browser CI stubs the external script and artifact tests verify a single tracker.

## Website regression policy

FAQ summaries use explicit text and decorative indicator columns, with identical layout when open or closed, native details semantics and no JavaScript dependency. The dedicated `site/website.browser.test.mjs` suite covers all 20 FAQs, desktop/tablet/mobile widths (320–1440 CSS px), both themes, keyboard toggling, sticky-header anchors, local downloads, loaded fonts, console/resource failures, persistence and no-JS content. Marketing tests intentionally isolate the heavy iframe; the separate native Workbench browser test validates actual rendering, theme sync and source/Preview actions. The Pages deployment workflow runs the marketing suite before publication. Browser screenshots are CI artifacts, not proof of manual visual approval.

## Scroll and focus contract

Native same-document anchors align to the measured sticky header bottom with no extra spacing. Scrolling is immediate (not globally animated), keeping fragment navigation, reload and browser history predictable. Only a first navigation with a fragment is corrected after header/font layout settles, and never after user interaction. Normal reload/history scroll restoration stays browser-owned. The real Workbench iframe and inner workbench root are inert during boot. A shared early focus guard inside the Workbench and nested Preview blocks passive programmatic focus/reveal calls until genuine interaction in the active frame; active focus uses preventScroll. The demo wrapper is excluded from scroll anchoring. No forced scroll-to-top, timer or global scroll lock is used. Tests cover all header destinations on desktop/tablet/mobile, initial fragments and real demo startup/reload through Preview readiness, including transient scroll events. Both marketing and real Workbench browser tests are required before the Pages artifact is published.

## Pages performance

The source remains native Geist HTML/CSS. `site/build-pages.mjs` assembles the production-only output in `.build/pages` with one minified content-hashed CSS file, inline early theme initialization, a minified hashed page script, and a content-versioned Demo release. The primary CTA links contain only text with no wrapping. The homepage loads the content-versioned Demo directly. Demo cache scope is strictly immutable same-origin release files, with best-effort browser storage, no stale marketing HTML, no unconditional precache and no forced activation. Both CI and deployment test the actual assembled artifact; marketing JS has a 10 KiB gzip budget, and real cold/warm Demo metrics are logged. Code-OSS service removal and iframe/scene reuse require separate measured dependency and lifecycle validation; no fake Workbench is introduced.
