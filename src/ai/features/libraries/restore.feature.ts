import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.restore',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'restore OpenSCAD project dependency',
        summary: 'Restore dependencies using authoritative lockfile commits; never silently re-resolve tags. Explicit workspace project path required; trust and path safety enforced. Cancellable; returns verified dependency state.',
        order: 26,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.restore',
        name: 'scad_ai_ide_libraries_restore',
        referenceName: 'scad_libraries_restore',
        modelDescription: 'Restore dependencies using authoritative lockfile commits; never silently re-resolve tags. Explicit workspace project path required; trust and path safety enforced. Cancellable; returns verified dependency state.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                project: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
            },
            required: ['project'],
        },
        risk: 'change',
        service: 'LibraryService.execute:restore',
        gui: 'Libraries restore/repair project',
        availability: 'librariesIdle',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'restoreHandler',
        },
    },
})
