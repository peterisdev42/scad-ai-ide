import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.cleanupPlan',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Plan global library cleanup',
        summary: 'Read-only preflight of single cache key or mode unused/all. Returns expiring server plan ID, candidates, bytes, protections and impact; does not delete. Requires trust.',
        order: 29,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.cleanupPlan',
        name: 'scad_ai_ide_libraries_cleanupPlan',
        referenceName: 'scad_libraries_cleanupPlan',
        modelDescription: 'Read-only preflight of single cache key or mode unused/all. Returns expiring server plan ID, candidates, bytes, protections and impact; does not delete. Requires trust.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                key: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
                mode: {
                    type: 'string',
                    enum: ['unused', 'all'],
                },
            },
            required: [],
        },
        risk: 'read',
        service: 'LibraryService.planCleanup',
        gui: 'Libraries cleanup preview',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'cleanupPlanHandler',
        },
    },
})
