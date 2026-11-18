import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.development.clearCaches',
    kind: 'tool',
    group: 'development',
    display: {
        label: 'Clear confirmed disposable caches',
        summary: 'Development mode only. Choose exactly one cache ID, scope or all=true. Independent user confirmation required; clears only disposable caches, reports partial failures and invalidates owners.',
        order: 36,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'development.clearCaches',
        name: 'scad_ai_ide_development_clearCaches',
        referenceName: 'scad_development_clearCaches',
        modelDescription: 'Development mode only. Choose exactly one cache ID, scope or all=true. Independent user confirmation required; clears only disposable caches, reports partial failures and invalidates owners.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
                scope: {
                    type: 'string',
                    enum: ['globalState', 'workspaceState', 'Memory', 'Disk'],
                },
                all: {
                    const: true,
                },
            },
            required: [],
        },
        risk: 'destructive',
        safetyReview: 'Preserves the existing VS Code confirmation and domain operation checks.',
        service: 'DeveloperCacheController.clearSafe',
        gui: 'More clearCache/clearScopeCaches/clearAllCaches',
        availability: 'developmentIdle',
        binding: {
            module: 'src/ai/handlers/development.ts',
            export: 'clearCachesHandler',
        },
    },
})
