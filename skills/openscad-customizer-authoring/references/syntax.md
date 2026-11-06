# Supported authoring subset

Reference: [Customizer manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer), checked 2026-11-06. This IDE uses its shared static Parser, not the whole OpenSCAD interpreter. Runtime verification is independent.

| Widget | Declaration |
|---|---|
| Slider | `width = 40; // [10:5:100]` |
| Max-only slider | `count = 5; // [10]` |
| Spinbox | `offset = 2.5; // .5` |
| Dropdown | `quality = 2; // [1:Draft,2:Normal,3:Fine]` |
| String dropdown | `shape = "round"; // [round:Round,square:Square]` |
| Checkbox | `hollow = true;` |
| Textbox | `label = "Model"; // 20` |
| Vector | `size = [20,30,40]; // [0:5:100]` |

Use only finite literal defaults, or numeric vectors of 1–4 elements. Preserve UTF-16 source positions, Unicode names and CRLF. Place declarations before the first real `{`; include/use are not followed. Duplicate assignments may supersede parameters. Standalone block headings group subsequent declarations until the next heading. Hidden suppresses controls. Global retains current IDE semantics; the IDE need not render tabs exactly like desktop OpenSCAD.
