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

Product-level CSS belongs in `site/styles.css` (layout) or `site/components/` (illustrations). Use semantic color, spacing, type and material tokens rather than ad hoc colors or radii. The embedded real Code-OSS Workbench and Preview keep their native VS Code theme and behavior; do not restyle those as marketing UI. Native HTML stays readable without JS. No React, Next.js, external CDN or third-party Geist UI library.

## Acceptance

`node --test site/geist.test.mjs` checks the layer graph, colors, tokens and theme behavior. Existing SEO/demo tests and Chromium browser checks run in CI; screenshots cover website light/dark/mobile and native Preview. CI also runs on website pushes to main (no PR required).

The root remains the sole canonical product page. All eight anchors, product manifest, FAQ, llms.txt, sitemap, status qualifications and legacy redirects are preserved. Illustrations remain illustrative; real desktop screenshots and recorded Agent acceptance are outstanding. Umami is out of scope.
