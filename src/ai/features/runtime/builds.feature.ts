import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.builds',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'List OpenSCAD builds',
        summary: 'Read all downloadable OpenSCAD CLI releases for the extension host, including exact build IDs, versions, channels and installed flags. Set refresh=true to force the SAME online refresh as the GUI Available Refresh button, even when cached. Follow builds.hasMore/nextOffset; optional channel filter. Catalog errors fail explicitly; installed versions/current CLI are available from runtime_state. Network read only. recommendedBuild returns the full recommended release independently of filtering/pagination, matching the GUI recommendation card.',
        order: 4,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'runtime.builds',
        name: 'scad_ai_ide_runtime_builds',
        referenceName: 'scad_runtime_builds',
        modelDescription: 'Read all downloadable OpenSCAD CLI releases for the extension host, including exact build IDs, versions, channels and installed flags. Set refresh=true to force the SAME online refresh as the GUI Available Refresh button, even when cached. Follow builds.hasMore/nextOffset; optional channel filter. Catalog errors fail explicitly; installed versions/current CLI are available from runtime_state. Network read only. recommendedBuild returns the full recommended release independently of filtering/pagination, matching the GUI recommendation card.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                refresh: {
                    type: 'boolean',
                },
                channel: {
                    type: 'string',
                    enum: ['Stable', 'RC', 'Test', 'Snapshot', 'Unknown'],
                },
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
        service: 'RuntimeService.loadBuilds',
        gui: 'Runtime Available/refresh',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'buildsHandler',
        },
    },
})
