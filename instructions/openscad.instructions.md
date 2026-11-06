---
name: SCAD AI IDE managed OpenSCAD capabilities
description: Use when managing OpenSCAD runtimes, library dependencies, Customizer parameters or SCAD AI IDE diagnostics.
applyTo: '**/*.scad,**/.scad/dependencies*.json'
---
Discover SCAD AI IDE capabilities with `scad_ai_ide_capabilities_discover`, then query actual state before changing it. Do not guess installed runtime paths, library versions, parameters or authentication status. Tools operate on the workspace extension host, including SSH/WSL/containers; paths are not client-machine paths.
Use managed tools for runtimes, `.scad/dependencies.json`, `.scad/dependencies.lock.json`, global library sources and presets. Do not manually modify managed storage or bypass locks. Supply explicit project, exact IDs/versions and fresh Customizer target/revision. Customizer overrides affect Preview without editing SCAD source.
Destructive actions require actual human authorization. Tool JSON flags cannot authorize deletion. Plan library cleanup first; execute only the returned unexpired plan ID. Read the result and verify postconditions; errors/cancellation are not success.
Cache tools require extension Development mode. Do not suggest them in production. Never expose credentials; inspect only one redacted bounded cache entry when needed. Ordinary GUI use requires no AI subscription. Harness support for VS Code extension tools varies.
