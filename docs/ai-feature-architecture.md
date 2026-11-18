# Unified AI feature architecture

Each feature has one typed declaration under `src/ai/features/<domain>/`. For a guidance feature, the declaration refers to a bundled Markdown file. Its frontmatter supplies the name and description. Tool declarations refer to named exports under `src/ai/handlers/`.

| Component | Responsibility |
| --- | --- |
| Feature Contract | Stable identity, kind, UI text, user preference defaults, dependencies and permissions |
| Build compiler | Discovers pure declarations and Markdown. Validates links, inputs and GUI parity. Projects VS Code contributions, Settings, bindings, catalog and Panel contracts. |
| Feature Registry and Policy Engine | Read the generated catalog. Evaluate application preferences, hard dependencies, Workspace Trust and live domain availability. |
| Tool Host Adapter and Dispatcher | Register each tool once, request native confirmations, re-evaluate policy on every invoke, validate input with Ajv and preserve operation, cancellation and image results. |
| Guidance contributions | Delegate discovery of bundled Skills, Instructions, Prompts and Custom Agents to VS Code through generated `when` clauses. |
| Feature State Service and AI Panel | Render metadata and revisioned status. Send typed feature mutations that the host validates before writing VS Code Settings. |

## Add a feature

Use a stable ID, declared group and explicit default. Published IDs, Tool names, prompt reference names and resource paths are public contracts. Follow a declared hard dependency only when the dependent feature cannot operate without it. Use `recommends` for optional relationships.

### Tool

Add `src/ai/features/discovery/describeEnvironment.feature.ts`.

```ts
import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.discovery.describeEnvironment',
    kind: 'tool',
    group: 'discovery',
    display: { label: 'Describe environment', summary: 'Identify the current runtime host.', order: 60 },
    control: { enabledByDefault: true, userConfigurable: true, scope: 'application' },
    tool: {
        capabilityId: 'discovery.describeEnvironment',
        name: 'scad_ai_ide_describeEnvironment',
        referenceName: 'scad_describeEnvironment',
        modelDescription: 'Read the extension host platform.',
        inputSchema: { type: 'object', additionalProperties: false },
        risk: 'read',
        service: 'Node platform',
        gui: 'None',
        binding: { module: 'src/ai/handlers/environment.ts', export: 'describeEnvironment' },
    },
})
```

Add its named implementation to `src/ai/handlers/environment.ts`.

```ts
import type { ToolHandler } from '../contracts/ToolServices'

export const describeEnvironment: ToolHandler = () => ({ platform: process.platform })
```

Add `requiresTrust` where a feature can touch workspace resources or execute trusted workspace code. Declare `requiresInteraction` for human participation, and include the security review for a destructive or privileged operation. Keep independent confirmations, exact-target checks and revision checks in the domain service.

### Skill

Add `skills/openscad-environment/SKILL.md`.

```md
---
name: openscad-environment
description: Identify the platform running the OpenSCAD extension.
---
Use `scad_ai_ide_describeEnvironment` to check the extension host platform.
```

Add `src/ai/features/discovery/openscad-environment.feature.ts`.

```ts
import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.discovery.openscad-environment',
    kind: 'skill',
    group: 'discovery',
    display: { order: 210 },
    control: { enabledByDefault: true, userConfigurable: true, scope: 'application' },
    dependencies: { allOf: ['tool.discovery.describeEnvironment'] },
    resource: { path: './skills/openscad-environment/SKILL.md' },
})
```

### Instruction

Add `instructions/environment.instructions.md`.

```md
---
name: OpenSCAD environment
description: Refer to the extension host for OpenSCAD runtime operations.
applyTo: '**/*.scad'
---
Check the extension host platform before suggesting platform-specific runtime steps.
```

Add `src/ai/features/discovery/environment-instructions.feature.ts`.

```ts
import { defineInstruction } from '../../contracts/Feature'

export default defineInstruction({
    id: 'instruction.discovery.environment',
    kind: 'instruction',
    group: 'discovery',
    display: { order: 220 },
    control: { enabledByDefault: true, userConfigurable: true, scope: 'application' },
    dependencies: { recommends: ['tool.discovery.describeEnvironment'] },
    resource: { path: './instructions/environment.instructions.md' },
})
```

The compiler also accepts `definePrompt` with a `prompts/*.prompt.md` asset and `defineChatAgent` with an `agents/*.agent.md` asset. For a dotted capability ID reference in Markdown, use an explicit `<!-- tool: discovery.describeEnvironment -->` marker so the compiler can distinguish Tool IDs from result fields.

## Generate and verify

Run `npm run generate:agents` on a named feature branch. It updates only managed manifest contributions, the managed Settings section, `src/ai/generated/` and the generated capability and GUI parity documents. Each output is replaced atomically. `npm run check:agents` is read-only and identifies stale outputs. Commit declarations, implementations and generated files together.

Run `npm run test:agents:manifest`, `npm run test:capabilities`, `npm run test:agents:ui` and the VS Code integration tests. Use `npm run verify:agents:vsix -- <path>` to audit the packaged assets. GUI business actions are audited independently in `src/core/capabilities/gui-actions.json`.

## Gate and update semantics

The Agent integration toggle applies globally. Guidance adds a second gate for Skills and Instructions. Group switches retain all item values. Every invocation checks the live item, group, dependency, trust and environment policy before the handler starts. Ordinary GUI and commands keep their own domain rules. Editor assistance uses the existing VS Code Settings scopes and operates independently of Agent preferences.

The Panel separates saved intent from effective availability. Pending writes retain the last confirmed values, and failed writes surface the host error. Config changes, trust grants and domain changes update the existing DOM without removing focus or expanding collapsed groups.

VS Code's `vscode.lm.tools` exposes registered tool metadata even when Chat candidate discovery filters a tool out by its `when` clause. Cached names still hit the same runtime gate. Guidance contributions control new loads. Guidance already present in a conversation remains there.

The migration is one cutover. To roll back, revert the entire feature commit.
