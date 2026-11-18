import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.search',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Search OpenSCAD libraries',
        summary: 'Search real registry metadata for IDs, exact versions and supported layouts. Bounded query, pagination and optional detail ID. Returns freshness/errors; no install. Includes the same layout/installability errors, version labels and cached flags shown in GUI registry rows.',
        order: 20,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'libraries.search',
        name: 'scad_ai_ide_libraries_search',
        referenceName: 'scad_libraries_search',
        modelDescription: 'Search real registry metadata for IDs, exact versions and supported layouts. Bounded query, pagination and optional detail ID. Returns freshness/errors; no install. Includes the same layout/installability errors, version labels and cached flags shown in GUI registry rows.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                query: {
                    type: 'string',
                    maxLength: 500,
                },
                id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
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
        service: 'LibraryService.search',
        gui: 'Libraries registry/search/version details',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'searchHandler',
        },
    },
})
