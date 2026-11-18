import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.remove',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'remove OpenSCAD project dependency',
        summary: 'Remove project dependency; preserves global cached sources. Explicit workspace project path required; trust and path safety enforced. Cancellable; returns verified dependency state.',
        order: 25,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.remove',
        name: 'scad_ai_ide_libraries_remove',
        referenceName: 'scad_libraries_remove',
        modelDescription: 'Remove project dependency; preserves global cached sources. Explicit workspace project path required; trust and path safety enforced. Cancellable; returns verified dependency state.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                project: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
                id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: ['project', 'id'],
        },
        risk: 'change',
        service: 'LibraryService.execute:remove',
        gui: 'Libraries remove',
        availability: 'librariesIdle',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'removeHandler',
        },
    },
})
