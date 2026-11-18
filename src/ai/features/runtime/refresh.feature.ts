import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.refresh',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Discover OpenSCAD runtimes',
        summary: 'Rescan locally installed CLI runtimes (default mode=rescan), or coalesce a silent Installed-tab refresh with mode=installed. Requires Workspace Trust because discovery probes executables. Does not refresh the ONLINE catalog: use runtime_builds with refresh=true for the GUI Available Refresh action. Returns selected CLI, installed inventory and discovery status.',
        order: 5,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'runtime.refresh',
        name: 'scad_ai_ide_runtime_refresh',
        referenceName: 'scad_runtime_refresh',
        modelDescription: 'Rescan locally installed CLI runtimes (default mode=rescan), or coalesce a silent Installed-tab refresh with mode=installed. Requires Workspace Trust because discovery probes executables. Does not refresh the ONLINE catalog: use runtime_builds with refresh=true for the GUI Available Refresh action. Returns selected CLI, installed inventory and discovery status.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                mode: {
                    type: 'string',
                    enum: ['rescan', 'installed'],
                },
            },
            required: [],
        },
        risk: 'change',
        service: 'RuntimeService.refresh',
        gui: 'Runtime refresh/refreshInstalled command',
        availability: 'runtimeIdle',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'refreshHandler',
        },
    },
})
