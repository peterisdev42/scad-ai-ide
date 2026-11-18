import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.state',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Read OpenSCAD Runtime: current CLI and installed versions',
        summary: 'Read the SAME local runtime inventory as Runtime Panel, without opening it. state.activeRuntime is the currently selected CLI with full version, command.executable, argsPrefix, source and release metadata, or null if none is selected; it is independent of pagination. state.runtimes.items lists detected installed CLI versions/paths/sources; follow hasMore/nextOffset to enumerate all. discovery reports ready/restricted/error and configured-path failures. This inventory is on the workspace extension host, not necessarily the client machine, and is not an exhaustive filesystem scan. Use runtime_refresh when stale; discovery/probing requires Workspace Trust. runtime_builds lists downloadable releases, NOT installed versions.',
        order: 3,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'runtime.state',
        name: 'scad_ai_ide_runtime_state',
        referenceName: 'scad_runtime_state',
        modelDescription: 'Read the SAME local runtime inventory as Runtime Panel, without opening it. state.activeRuntime is the currently selected CLI with full version, command.executable, argsPrefix, source and release metadata, or null if none is selected; it is independent of pagination. state.runtimes.items lists detected installed CLI versions/paths/sources; follow hasMore/nextOffset to enumerate all. discovery reports ready/restricted/error and configured-path failures. This inventory is on the workspace extension host, not necessarily the client machine, and is not an exhaustive filesystem scan. Use runtime_refresh when stale; discovery/probing requires Workspace Trust. runtime_builds lists downloadable releases, NOT installed versions.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                offset: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: [],
        },
        risk: 'read',
        service: 'RuntimeService.getState',
        gui: 'Runtime Installed',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'stateHandler',
        },
    },
})
