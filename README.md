# SCAD AI IDE

**OpenSCAD development, made simple in the VS Code you already know.**

**New to OpenSCAD?** Start modeling through an intuitive interface instead of manually managing runtimes, environment variables, and third-party libraries. **Already experienced?** Keep your VS Code setup, Git, terminal, extensions, and AI coding tools—without switching to a separate OpenSCAD IDE.

**You choose how to work.** Build by hand, collaborate with AI, or eventually delegate the whole workflow to an agent. Our long-term design principle is: **every IDE capability offered to people should also be available to AI agents through shared, controlled tools.**

_From code to solid._

[Website](https://peterisdev42.github.io/scad-ai-ide/) · [Quick start](#quick-start) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md)

## Features at a glance

| Feature                         | What you can do                                                                     | Status           |
| ------------------------------- | ----------------------------------------------------------------------------------- | ---------------- |
| **OpenSCAD language support**   | Syntax highlighting, completions, diagnostics, navigation, renaming, and formatting | ✅ Available     |
| **Interactive 3D preview**      | View models in VS Code, switch views, rotate, and zoom                              | ✅ Available     |
| **Customizer**                  | Adjust parameters using sliders and inputs; save and switch presets                 | ✅ Available     |
| **Model inspection and export** | Measure, inspect sections, export STL / 3MF, and launch your slicer                 | ✅ Available¹    |
| **OpenSCAD Runtime**            | Discover, install, switch, and manage OpenSCAD runtimes                             | ✅ Available     |
| **Libraries**                   | Find libraries, lock and restore project dependencies, and manage a shared cache    | ✅ Available     |
| **3D preview in Markdown**      | Interactively preview `openscad` / `scad` code blocks in documentation              | ✅ Available     |
| **Per-part coloring**           | Automatically color separate parts in a multi-part model for easier inspection      | 🧪 Experimental³ |
| **Fast CSG preview**            | Preview CSG with a separate image-space Preview Exporter                            | 🧪 Experimental² |
| **AI agent integrations**       | Agent Tools, MCP, and Skills using the same IDE capabilities as people              | 📌 Planned       |

<sub>¹ Export formats and some inspection tools depend on the runtime and render mode. ² Fast CSG preview currently requires a separately installed Preview Exporter on supported macOS ARM64 setups. ³ Per-part coloring changes only the preview, not source files, presets, or exports; overlapping or complex geometry can be misidentified. **AI agent interfaces are not yet available, and this extension cannot currently build a model autonomously from a text prompt.**</sub>

## Why SCAD AI IDE?

### For beginners: focus on modeling, not configuration

Like a beginner-friendly development environment, SCAD AI IDE aims to make toolchain setup straightforward. Manage OpenSCAD installations through **Runtime**, project dependencies through **Libraries**, and your design through **Preview** and **Customizer**—without manually setting a system-wide `OPENSCADPATH`.

### For experienced users: keep the tools you know

Stay in VS Code with your own shortcuts, editor settings, Git, terminal, and extensions. Get dedicated OpenSCAD language tooling, modeling views, and project management **without switching between VS Code and the standalone OpenSCAD IDE**.

### For everyone: your tools, your choice

Manual design and agent-driven development should share one underlying toolchain. Our goal is to offer controlled access to the same rendering, diagnostics, parameters, runtimes, and dependency operations—whether a person or AI agent initiates them.

> **Current status:** Core IDE features are implemented. Agent Tools, MCP, Skills, and end-to-end AI modeling are **planned, not yet available**.

## Quick start

SCAD AI IDE is under active development and **does not yet offer an official GitHub Release installer**. For now, you can run it from source.

<details>
<summary><strong>Run from source (developers)</strong></summary>

You need a VS Code version compatible with [`package.json`](package.json), Node.js 24, npm, and Git. Preparing the language server may also require Rust and Cargo.

```bash
git clone --recurse-submodules https://github.com/peterisdev42/scad-ai-ide.git
cd scad-ai-ide
npm ci
npm run prepare:lsp
npm run compile
```

Open the repository in VS Code and press **F5** to launch an Extension Development Host.

</details>

**Open your first model:**

1. Create or open a saved `.scad` file in a trusted workspace.
2. Open **Quick Access → Runtime** to select or install an OpenSCAD runtime.
3. Run **SCAD AI IDE: Open as Preview**, then rotate and inspect the model.
4. Adjust parameters in **Customizer**; render or export STL / 3MF when ready.

Switch between source and preview with **macOS `Cmd + Shift + V`** or **Windows / Linux `Ctrl + Shift + V`**.

## Feature details

### Edit, preview, and customize

OpenSCAD language support and an interactive 3D viewport bring code editing, model navigation, measurements, and section inspection together. Customizer provides visual parameter controls and OpenSCAD-compatible JSON presets. Parameter overrides do not silently rewrite your source code. Markdown `openscad` / `scad` code blocks can also show interactive 3D models.

Standard rendering and export use the selected OpenSCAD CLI. The experimental **Color parts separately** toggle helps distinguish parts of an assembly; it only changes preview appearance and may be inaccurate for complex geometry. Experimental fast CSG preview has separate platform and rendering limitations.

See the [preview architecture](docs/preview-exporter-architecture.md) and [per-part coloring notes](docs/part-colors.md).

### Runtime and Libraries: easier, reproducible projects

Runtime discovers, installs, and switches OpenSCAD versions across Windows, macOS, Linux, and supported VS Code remote environments. Libraries is organized into **Registry** (discovery), **Project** (dependencies), and **Global** (shared versioned storage).

Projects record exact dependencies in `.scad/dependencies.json` and `.scad/dependencies.lock.json`. Local `.scad/lib` uses directory links, with an explicit copy fallback when required. Removing a project dependency does not automatically delete shared cached versions; global cleanup requires reference checks and confirmation. General version-range resolution and automatic transitive dependency installation are not yet supported.

See the [library manager documentation](docs/library-manager.md).

### AI agents: one IDE, shared capabilities

We plan to expose existing IDE services through **VS Code Agent Tools, MCP, and Skills** so people and agents can work with the same capabilities and permission boundaries. You should be able to build manually, collaborate with AI, or delegate tasks while retaining control of the result.

**These agent interfaces are planned and are not available in the current version.**

## Development and contributing

Feedback and contributions are welcome through [GitHub Issues](https://github.com/peterisdev42/scad-ai-ide/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for build and testing instructions, and the [documentation index](docs/README.md) for technical details.

SCAD AI IDE is licensed under [GPL-3.0](LICENSE). It is an independent community project built on the [OpenSCAD](https://openscad.org/) and [VS Code](https://code.visualstudio.com/) ecosystems, not an official project of either.

### Agent tools and shared capabilities

SCAD AI IDE contributes 37 VS Code Language Model Tools for Runtime, Customizer,
Libraries and safe diagnostics, plus one targeted Instruction and four task Skills.
GUI, commands and tools share domain services; tools work without opening panels.
The AI Panel lists every tool in six category tables with permissions and live
availability, followed by the bundled Instruction and Skills.
Customizer changes are per-model overrides and do not edit SCAD source. Project
library writes use an explicit workspace project and exact versions. Destructive
operations independently ask for user authorization; Development cache access is
hard-disabled in normal installations.

See the [capability matrix](docs/agent-capability-matrix.md),
[exact tool catalog](docs/agent-capability-catalog.md) and
[verification/manual acceptance](docs/agent-verification.md) for permissions,
workflows and the remaining model/host validation limits. VS Code extension-tool
availability depends on the Agent harness; the GUI needs no AI subscription.

For contributors, run `npm run generate:agents` after editing the capability catalog;
`npm run check:agents` checks the manifest/resources/matrix and
`npm run test:capabilities` exercises the shared contracts and adapters.

Observed model failures and remaining acceptance cases are maintained in the
[Agent verification guide](docs/agent-verification.md).

For local LLM development testing, choose **Run Extension + Ollama** in the F5
launch configuration. It retains `--disable-extensions` and explicitly loads this project plus the
locally installed `Ollama.ollama` as development extensions. See [Ollama development setup](docs/ollama-development.md)
for model selection, custom installation paths and the real-host discovery smoke.
