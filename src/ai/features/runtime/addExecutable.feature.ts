import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.addExecutable',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Add OpenSCAD executable',
        summary: 'Probe and select a host-local executable or macOS app at an absolute path. Changes global runtime selection after validation; trust required.',
        order: 8,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'runtime.addExecutable',
        name: 'scad_ai_ide_runtime_addExecutable',
        referenceName: 'scad_runtime_addExecutable',
        modelDescription: 'Probe and select a host-local executable or macOS app at an absolute path. Changes global runtime selection after validation; trust required.',
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
        service: 'RuntimeService.addExecutable',
        gui: 'Runtime addExecutable',
        availability: 'runtimeIdle',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'addExecutableHandler',
        },
    },
})
