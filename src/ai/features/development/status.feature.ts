import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.development.status',
    kind: 'tool',
    group: 'development',
    display: {
        label: 'Read development diagnostics availability',
        summary: 'Read whether extension runs in Development mode. Safe in production; reports reason when cache tools are disabled.',
        order: 33,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'development.status',
        name: 'scad_ai_ide_development_status',
        referenceName: 'scad_development_status',
        modelDescription: 'Read whether extension runs in Development mode. Safe in production; reports reason when cache tools are disabled.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
        },
        risk: 'read',
        service: 'DeveloperCacheController.enabled',
        gui: 'More Development visibility',
        binding: {
            module: 'src/ai/handlers/development.ts',
            export: 'statusHandler',
        },
    },
})
