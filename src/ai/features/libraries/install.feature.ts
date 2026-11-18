import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.install',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'install OpenSCAD project dependency',
        summary: 'Install exact version label returned by libraries_search; writes project manifest/lock and mounts using shared atomic transactions. Explicit workspace project path required; trust and path safety enforced. Cancellable; returns verified dependency state.',
        order: 24,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.install',
        name: 'scad_ai_ide_libraries_install',
        referenceName: 'scad_libraries_install',
        modelDescription: 'Install exact version label returned by libraries_search; writes project manifest/lock and mounts using shared atomic transactions. Explicit workspace project path required; trust and path safety enforced. Cancellable; returns verified dependency state.',
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
                version: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: ['project', 'id', 'version'],
        },
        risk: 'change',
        service: 'LibraryService.execute:install',
        gui: 'Libraries install',
        availability: 'librariesIdle',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'installHandler',
        },
    },
})
