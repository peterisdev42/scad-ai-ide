import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.refresh',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Refresh OpenSCAD registry',
        summary: 'Refresh registry independent of panels. Network read, returns actual catalog status/errors; cached data is identified.',
        order: 21,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'libraries.refresh',
        name: 'scad_ai_ide_libraries_refresh',
        referenceName: 'scad_libraries_refresh',
        modelDescription: 'Refresh registry independent of panels. Network read, returns actual catalog status/errors; cached data is identified.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
        },
        risk: 'read',
        service: 'LibraryService.loadRegistry',
        gui: 'Libraries refresh',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'refreshHandler',
        },
    },
})
