# Supported authoring subset

Reference: pinned `sources/openscad` SHA `bcf45a22caa954ca56ca287994cb6dbc368c67b2` (`ParameterObject.cc`, `CommentParser.cc`, `comment_lexer.l`), plus [Customizer manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer), checked 2026-11-06. This IDE uses its shared static Parser, not the whole OpenSCAD interpreter. Runtime verification is independent.

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

Use only finite literal defaults, or numeric vectors of 1–4 elements. Preserve UTF-16 source positions, Unicode names and CRLF. Place declarations before the line containing the first `{`; the pinned annotation scanner also treats braces in include filenames as a cutoff quirk. A hint belongs on the declaration's first line and is ignored for multiple declarations sharing that line. Description is only the immediately preceding column-one `//` line. Numeric bounds are declared intent; native effective bounds can widen to defaults. Step does not reject off-grid values. String size is a UTF-8 byte limit, with no IDE truncation. Source literals and hint tokens have distinct lexical grammars; include/use are not followed. Duplicate assignments may supersede parameters. Standalone block headings group subsequent declarations until the next heading. Hidden suppresses controls. Global groups remain visible alongside explicit groups; the IDE need not render tabs exactly like desktop OpenSCAD.
