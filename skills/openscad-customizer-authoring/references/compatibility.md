# Compatibility boundaries

Reference source: OpenSCAD commit bcf45a22caa954ca56ca287994cb6dbc368c67b2. Repository evidence includes a 41-case native CLI/schema differential corpus and separate preset import probes. The executable used for probes is 2026.11-RC0 build 9ba0cee7c94785fac0ca8dfe040b965a12a25ed1; relevant Customizer source files match the reference. This does not verify the full pinned binary or native Desktop GUI.

- Descriptions come only from a column-one // line immediately above the assignment.
- Annotation cutoff is the entire first brace line. Include filename braces have a pinned scanner quirk; do not promise full language parsing. Includes are not evaluated.
- A multiline declaration's hint belongs on its first line. Multiple declarations sharing a line do not acquire the final tail hint.
- Source literal grammar and annotation token grammar differ. Do not assume hex literals or Unicode escape sequences have identical meanings inside hints.
- Unicode identifiers depend on the native build and experimental feature profile. The GUI-build differential run explicitly enables `--enable=unicode-identifiers`; managed CLI builds used in CI have no such switch. Static NFC matching does not establish that an arbitrary compiler accepts Unicode identifiers with its default options.
- Numeric declared bounds express intent; effective native bounds widen for defaults except special implicit limits such as max-only slider minimum zero. Step controls interaction, not value validity. Agent or preset off-grid numbers must not be rounded by validation.
- StringParameter's maximumSize constructor parameter shadows its member: no automatic length expansion is established. Native import truncates UTF-8 bytes and can split a character. The IDE rejects oversize input without loss; source defaults are preserved.
- Native schema and import constraints are separate observations. A max-only numeric hint exports an implicit minimum of zero, but CLI import only clamps an explicit minimum member and can preserve a negative default. Text defaults are also preserved when omitted from a preset, while explicitly importing an oversize default truncates it. Do not infer input, import or Desktop behavior from schema alone.
- Mixed enum choices retain order and types. Native preset import uses the first matching numeric or exact string interpretation.
- A partial preset selection starts with source defaults plus the selected set, clearing previous Overrides. Selecting design defaults clears all Overrides.
- Unknown file versions may be preserved and analyzed read-only. Do not apply or overwrite them, or rewrite their version marker, without verified compatibility. One successful CLI read is not blanket compatibility proof.

Source tools remain limited to explicit canonical workspace .scad files with host trust for editing. Editor Quick Fixes independently support writable providers and untitled/outside-workspace documents. Neither path saves source buffers. Static, Host API, browser, native CLI, native Desktop and model-driven evidence are distinct; report unavailable checks as NOT RUN.
