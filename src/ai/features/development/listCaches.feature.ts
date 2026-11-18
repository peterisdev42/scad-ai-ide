import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.development.listCaches',
    kind: 'tool',
    group: 'development',
    display: {
        label: 'List disposable cache metadata',
        summary: 'Development mode only. Returns bounded cache IDs/names/scopes without values. Installed runtimes, exporter and library sources/reference indices are excluded. Returns the extension-owned storage directory and pagination metadata; no cache values.',
        order: 34,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'development.listCaches',
        name: 'scad_ai_ide_development_listCaches',
        referenceName: 'scad_development_listCaches',
        modelDescription: 'Development mode only. Returns bounded cache IDs/names/scopes without values. Installed runtimes, exporter and library sources/reference indices are excluded. Returns the extension-owned storage directory and pagination metadata; no cache values.',
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
        risk: 'privileged',
        safetyReview: 'Preserves the existing VS Code confirmation and domain operation checks.',
        service: 'DeveloperCacheController.listSafe',
        gui: 'More cache list/refresh',
        availability: 'developmentIdle',
        binding: {
            module: 'src/ai/handlers/development.ts',
            export: 'listCachesHandler',
        },
    },
})
