import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.development.inspectCache',
    kind: 'tool',
    group: 'development',
    display: {
        label: 'Inspect redacted cache entry',
        summary: 'Development mode only. Inspect one exact cache ID from listCaches. Returns bounded redacted preview, which may still contain personal information. No arbitrary file reads.',
        order: 35,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'development.inspectCache',
        name: 'scad_ai_ide_development_inspectCache',
        referenceName: 'scad_development_inspectCache',
        modelDescription: 'Development mode only. Inspect one exact cache ID from listCaches. Returns bounded redacted preview, which may still contain personal information. No arbitrary file reads.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: ['id'],
        },
        risk: 'privileged',
        safetyReview: 'Preserves the existing VS Code confirmation and domain operation checks.',
        service: 'DeveloperCacheController.inspectSafe',
        gui: 'More inspectCache',
        availability: 'developmentIdle',
        binding: {
            module: 'src/ai/handlers/development.ts',
            export: 'inspectCacheHandler',
        },
    },
})
