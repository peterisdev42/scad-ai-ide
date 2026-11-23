# GitHub Pages Search & release checklist
Reviewed: 2026-11-23

1. Deploy `site/` to https://peterisdev42.github.io/scad-ai-ide/ using the existing Pages workflow; verify each canonical page and `sitemap.xml` serves HTTP 200.
2. In **Google Search Console**, add URL-prefix property `https://peterisdev42.github.io/scad-ai-ide/` (not the entire host if only the project is under your control). Use its supported verification procedure and submit `https://peterisdev42.github.io/scad-ai-ide/sitemap.xml`.
3. Use URL Inspection on the homepage, For beginners, AI agents, Why and Getting started pages; check rendered HTML, indexing status and selected canonical. Submission is not guaranteed indexing.
4. In **Bing Webmaster Tools**, verify/import the property and submit the same sitemap. Monitor crawler/index status over time.
5. GitHub Project Pages cannot define a domain-wide robots.txt by placing it at `/scad-ai-ide/robots.txt`. Only `https://peterisdev42.github.io/robots.txt` is the host-root robots file. Do not add a misleading project-level robots file.
6. Validate all Open Graph cards with a share/debugger service; do not assert a crawler preview is correct from HTML alone.
7. Public marketing facts must match `docs/marketing/product-claims.json` and `README.md`. Review public competitors periodically.
8. No Umami until the separate analytics phase is approved and the actual Cloud website ID is available.
