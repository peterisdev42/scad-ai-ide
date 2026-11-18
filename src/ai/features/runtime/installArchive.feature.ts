import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.installArchive',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Install OpenSCAD archive',
        summary: 'Install a host-local archive at an absolute path. Validates archive safety and probes runtime; managed storage only, trust required. Supports cancellation.',
        order: 7,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'runtime.installArchive',
        name: 'scad_ai_ide_runtime_installArchive',
        referenceName: 'scad_runtime_installArchive',
        modelDescription: 'Install a host-local archive at an absolute path. Validates archive safety and probes runtime; managed storage only, trust required. Supports cancellation.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                path: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
            },
            required: ['path'],
        },
        risk: 'change',
        service: 'RuntimeService.installArchivePath',
        gui: 'Runtime installArchive',
        availability: 'runtimeIdle',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'installArchiveHandler',
        },
    },
})
