# SCAD AI IDE

<img src="resources/icon.png" alt="SCAD AI IDE cheese logo" width="76" height="76">

**An open-source, agent-ready OpenSCAD development environment inside Visual Studio Code.**

_From code to solid._

SCAD AI IDE brings OpenSCAD language tooling, interactive 3D preview, runtime and library management, parameter customization, and evidence-aware CAD verification into one VS Code workflow. Native VS Code Agent Tools can use the same bounded services as the GUI, with explicit permission gates. It is currently a source-first development preview.

[Website](https://peterisdev42.github.io/scad-ai-ide/) · [Why SCAD AI IDE](https://peterisdev42.github.io/scad-ai-ide/#comparison) · [For beginners](https://peterisdev42.github.io/scad-ai-ide/#audiences) · [For AI agents](https://peterisdev42.github.io/scad-ai-ide/#agent-integration) · [Getting started](https://peterisdev42.github.io/scad-ai-ide/#getting-started) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md)

> **Project status — active development.** Core IDE workflows are implemented and can be run from source, but this is **not yet a general-availability release**. There is no official GitHub Release installer or Marketplace distribution. End-to-end Agent, real-host and cross-platform acceptance is still in progress. See [validation and known limitations](#validation-and-known-limitations).

## What works today

| Area | Implemented capabilities | Readiness |
| --- | --- | --- |
| **Language support** | Syntax highlighting, snippets, completions, diagnostics, navigation, rename and formatting via OpenSCAD LSP | Implemented |
| **Interactive 3D preview** | Rotate, zoom, view navigation, measurement, section inspection and model export | Implemented; some operations depend on the runtime |
| **Customizer** | Visual parameter controls, overrides, OpenSCAD-compatible presets, source authoring analysis and safe structured editing | Implemented; Agent/model acceptance ongoing |
| **Runtime Manager** | Discover, install, select and manage OpenSCAD CLI versions | Implemented |
| **Libraries Manager** | Registry discovery, exact-version project dependencies, lock/restore, shared versioned store and cleanup | Implemented; Windows native-path limitation |
| **Markdown 3D preview** | Interactive previews for `openscad` / `scad` code blocks | Implemented |
| **CAD diagnostics** | CLI-backed CSG checks, issue details, shared VS Code Problems and snapshot invalidation | Implemented; end-to-end acceptance ongoing |
| **Mesh & assembly verification** | Raw STL/3MF checks, measurements, frozen PNG views, declared-part static assembly constraints and report comparison | Implemented; validation ongoing |
| **Native Agent integration** | 53 VS Code Language Model Tools, 12 Skills and 2 Instructions using shared services and permission gates | Implemented; provider/host/model acceptance ongoing |
| **Per-part coloring** | Distinct preview colors for separated parts | Experimental; visual-only |
| **Fast CSG preview** | Image-space CSG rendering through a separate Preview Exporter | Experimental with a compatible local macOS ARM64 exporter |

**Implemented** means the feature is present in the source, not that every machine, model and workflow has passed final release acceptance. Bricks is not currently a shipped workflow.

## Why SCAD AI IDE?

### Start modeling, not configuring

Select an OpenSCAD runtime, discover third-party libraries and adjust parameters in VS Code instead of manually assembling a toolchain. The extension injects a **project-scoped `OPENSCADPATH`** when launching its OpenSCAD processes; you do not need to overwrite your global environment.

### Keep the tools you already use

Stay with VS Code, Git, your terminal, editor shortcuts and other extensions. Use a first-class OpenSCAD language experience alongside an interactive Preview and Customizer.

### Verify changes instead of trusting a screenshot

CAD tools can analyze OpenSCAD/CSG diagnostics, inspect raw meshes, measure frozen geometry, check declared static assemblies, compare reports and retain evidence. Reports distinguish `PASS`, `FAIL` and `UNRESOLVED` when the available evidence is insufficient. **A clean CSG check is not proof of a watertight mesh, correct assembly, safe clearances or printability.**

### Choose manual or agent-assisted workflows

The same underlying domain services power GUI actions and native VS Code Agent Tools. Tools expose bounded inputs, explicit permissions and snapshot-aware results; writes and destructive operations keep their authorization boundaries. The current Agent integration is **native to VS Code**—an MCP server is **not** part of the current scope.

## Quick start

The project is currently **source-first**. You need a compatible VS Code installation (minimum version: **1.140.0**), **Node.js 24**, npm and Git; building the language server from source may additionally require Rust/Cargo and platform build tools.

```bash
git clone --recurse-submodules https://github.com/peterisdev42/scad-ai-ide.git
cd scad-ai-ide
npm ci
npm run prepare:lsp
npm run compile
```

Open the repository in VS Code and press **F5** to launch the Extension Development Host. If the language server cannot be prepared from a prebuilt artifact, follow [CONTRIBUTING.md](CONTRIBUTING.md) for build prerequisites.

**Your first model:**

1. In the Extension Development Host, open a trusted workspace with a saved `.scad` file.
2. Open **Quick Access → Runtime** and select an available OpenSCAD CLI.
3. Run **SCAD AI IDE: Open as Preview**; rotate or zoom the model.
4. Use **Customizer** to change parameters, then render or export as supported by that runtime.
5. Optionally run **Analyze Model Diagnostics** or **Verify Raw CAD Mesh** to inspect evidence separately from the viewport.

Switch between source and preview using **Cmd + Shift + V** on macOS or **Ctrl + Shift + V** on Windows/Linux.

## Feature details

### Preview, customization and export

The Preview displays models in the editor, supports navigation, measurement and section inspection, and can export STL/3MF or send supported outputs to a slicer. Available operations depend on the selected CLI and rendering mode. Parameter overrides are applied without silently rewriting the `.scad` source. Customizer also supports native-style presets and source diagnostics/structured edits through explicit operations.

Experimental **Color parts separately** affects only the viewport and can misidentify overlapping/complex geometry. Experimental **Fast CSG preview** requires a compatible local macOS ARM64 Preview Exporter. The OpenSCAD runtime provides Full Render when the exporter is unavailable. See [Preview integration](docs/preview-integration.md), [Preview Exporter](docs/preview-exporter-architecture.md) and [part-color limitations](docs/part-colors.md).

### Runtime and library dependencies

**Runtime** discovers and manages OpenSCAD executables. **Libraries** offers Registry, Project and Global views. Project dependency declarations are stored in `.scad/dependencies.json` and exact pins in `.scad/dependencies.lock.json`. Project-local `.scad/lib` mounts entries from a shared, versioned store using links where feasible and an explicit copy fallback. Removing a project dependency does not erase its shared cached version; cleanup rechecks references and requires confirmation.

The current dependency manager intentionally supports **exact versions**, not arbitrary version ranges or automatic transitive dependency installation. See [Libraries documentation](docs/library-manager.md).

### Native Agent Tools, Skills and safety

The extension contributes **53 native VS Code Language Model Tools**, **12 Skills** and **2 Instructions**. They cover capability discovery/cancellation, Runtime, Customizer, Libraries, safe development status and CAD diagnostics/verification/review. A model preview link in chat opens its `.scad` file in the interactive OpenSCAD Preview editor. The AI Panel controls integration, groups and individual features and reports live availability. Tools can run while their management panels are closed. See the [feature architecture and declaration examples](docs/ai-feature-architecture.md).

Capability availability depends on the **VS Code Agent host and model provider**. Registration and deterministic tests do not establish reliable autonomous-model performance. The real-model CAD acceptance matrix remains open in several areas. See the [tool catalog](docs/agent-capability-catalog.md), [permissions matrix](docs/agent-capability-matrix.md), [Agent verification guide](docs/agent-verification.md) and [CAD progress report](docs/cad/overall-progress.md).

Customizer Agent source edits use explicit analysis, planning/commit and validation semantics, with revision/Hash protection. CAD tools produce snapshot-bound reports and can use VS Code Problems; standalone raw-mesh checks can work without an OpenSCAD runtime, while SCAD compilation and official PNG rendering require one. Unsaved include/use buffers are not silently saved or injected and may yield `UNRESOLVED`. Read the [Customizer acceptance report](docs/customizer/closeout-report.md), [CAD architecture](docs/cad-verification-architecture.md) and [mesh verification guide](docs/cad-mesh-verification.md).

## Validation and known limitations

The repository contains unit, VS Code Extension Host, browser/UI, native CLI and selected installed-VSIX test suites. They are **different levels of evidence**; a successful unit test or an installed smoke test does not count as a real-model or end-user acceptance pass.

- **Windows Unicode paths:** tests with the current Windows OpenSCAD CLI build fail when source, output or library paths contain certain non-ASCII characters. The issue is reproduced independently of the IDE's link/copy strategy. The underlying upstream-vs-build cause is not yet established. See [Windows investigation](docs/customizer/windows-unicode-closeout.md).
- **Agent CAD acceptance:** deterministic features are implemented, but strict dirty-buffer workflows, real interactive spatial feedback, some stable-host focus behavior, the default Agent harness and remaining platform/stress tests have not all passed final gates. See [current progress](docs/cad/overall-progress.md) and [manual acceptance](docs/cad/manual-acceptance.md).
- **Customizer Agent acceptance:** deterministic authoring and safety checks have evidence; some model-driven expression/answer-accuracy scenarios and additional platform combinations remain partial. See [closeout](docs/customizer/closeout-report.md).
- **Preview/export:** Fast CSG and per-part colors remain experimental; rendering and export support vary by CLI build and mode. Printability screening is **not** a printability certification.
- **Distribution:** no official Release installer or Marketplace entry exists yet. Cross-platform release readiness has not been signed off.

If a workflow reports `UNRESOLVED` or a tool is unavailable, treat that as a limitation—not as a successful CAD verification.

## Development and contributing

Useful contributor commands:

```bash
npm run check:agents
npm run check-types
npm run lint
npm test
npm run test:integration
```

Some integration tests need external binaries, a graphical host or other prerequisites; skips must not be mistaken for passing tests. For the full test matrix and build instructions, see [CONTRIBUTING.md](CONTRIBUTING.md). For the current VS Code debug launch and local CAD acceptance setup, see [development setup](CONTRIBUTING.md#准备环境) and the [CAD manual checklist](docs/cad/manual-acceptance.md).

Questions, bug reports and contributions are welcome via [GitHub Issues](https://github.com/peterisdev42/scad-ai-ide/issues). SCAD AI IDE is [GPL-3.0 licensed](LICENSE) and is an independent community project, not an official OpenSCAD, VS Code or Microsoft product.
