import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.repair',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Repair global library version',
        summary: 'Repair an exact cache key from globalState. Rechecks repository/commit identity; requires trust, supports cancellation and preserves source safety checks.',
        order: 28,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.repair',
        name: 'scad_ai_ide_libraries_repair',
        referenceName: 'scad_libraries_repair',
        modelDescription: 'Repair an exact cache key from globalState. Rechecks repository/commit identity; requires trust, supports cancellation and preserves source safety checks.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                key: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: ['key'],
        },
        risk: 'change',
        service: 'LibraryService.execute:repairGlobal',
        gui: 'Libraries repairGlobal',
        availability: 'librariesIdle',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'repairHandler',
        },
    },
})
