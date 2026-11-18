import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.cleanupExecute',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Execute confirmed library cleanup',
        summary: 'Execute an unexpired exact plan ID from cleanupPlan. Independently asks the human to authorize exact targets; JSON cannot approve deletion. Rechecks state/references under store locks. Returns actual removals.',
        order: 30,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.cleanupExecute',
        name: 'scad_ai_ide_libraries_cleanupExecute',
        referenceName: 'scad_libraries_cleanupExecute',
        modelDescription: 'Execute an unexpired exact plan ID from cleanupPlan. Independently asks the human to authorize exact targets; JSON cannot approve deletion. Rechecks state/references under store locks. Returns actual removals.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                planId: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: ['planId'],
        },
        risk: 'destructive',
        safetyReview: 'Preserves the existing VS Code confirmation and domain operation checks.',
        service: 'LibraryService.executeCleanup',
        gui: 'Libraries cleanup single/unused/all',
        availability: 'librariesIdle',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'cleanupExecuteHandler',
        },
    },
})
