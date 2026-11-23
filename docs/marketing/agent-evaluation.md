# Agent Understanding Evaluation — SCAD AI IDE
Version: 1.0 · Reviewed 2026-11-23

Purpose: test whether a **fresh** web-enabled AI agent can understand this product from public pages and citations, not whether a model remembers the project from training.

## Protocol
Use a new session with no descriptive pre-prompt beyond the homepage URL; inspect original HTML separately with JavaScript disabled. Save the run date, model/provider, URL access status, full answer, URLs cited, mistakes and suggested corrections. Repeat with at least two independent web-enabled agents if available.

Score each question 0 (wrong/unsupported), 1 (partially correct or missing a crucial limitation), or 2 (accurate with grounded citation and important limits). Target average ≥ 1.8; treat any claim of Marketplace availability, an MCP server, "only AI OpenSCAD extension" or verified printability as a **blocking error**.

## 12 prompts
1. What is SCAD AI IDE; is it a standalone CAD program or a VS Code extension?
2. Who is it for, and is it suitable for first-time OpenSCAD users?
3. How does it differ from OpenSCAD's official desktop application?
4. Compare it with SCAD Preview and OpenSCAD Renderer without inventing missing features.
5. What makes it distinctive? Is it the world's only AI OpenSCAD extension?
6. Can agents manage runtimes/libraries, adjust parameters and request verification, and what gates apply?
7. Does it bundle an LLM, ship an MCP server or work with all AI providers?
8. Can I install it from the Marketplace today? How do I run it?
9. Is the online 3D demo a live OpenSCAD compiler?
10. Does a clean CAD check guarantee printability? Explain UNRESOLVED.
11. How do exact-version library locks and project-scoped OPENSCADPATH work?
12. What are the Windows Unicode-path, experimental Fast CSG and Agent acceptance limitations?

## Record template
| Date | Provider/model | Question | Access/citations | Correct (0–2) | Critical error? | Required change |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |

Automated site tests can verify the pages contain critical facts. They cannot stand in for real independent Agent understanding runs. Do **not** report an evaluation as passed before a recorded run.
