import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.select',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Select OpenSCAD runtime',
        summary: 'Select the exact runtime ID from runtime_state. Changes global runtime configuration; returns actual active runtime and updates Preview. Trust and current identity required.',
        order: 9,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'runtime.select',
        name: 'scad_ai_ide_runtime_select',
        referenceName: 'scad_runtime_select',
        modelDescription: 'Select the exact runtime ID from runtime_state. Changes global runtime configuration; returns actual active runtime and updates Preview. Trust and current identity required.',
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
        risk: 'change',
        service: 'RuntimeService.select',
        gui: 'Runtime select',
        availability: 'runtimeIdle',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'selectHandler',
        },
    },
})
