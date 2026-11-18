import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.remove',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Remove managed OpenSCAD runtime',
        summary: 'Remove an exact managed runtime ID from runtime_state. Independent user confirmation required; unmanaged paths rejected. Revalidates managed identity and returns discovered state.',
        order: 10,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'runtime.remove',
        name: 'scad_ai_ide_runtime_remove',
        referenceName: 'scad_runtime_remove',
        modelDescription: 'Remove an exact managed runtime ID from runtime_state. Independent user confirmation required; unmanaged paths rejected. Revalidates managed identity and returns discovered state.',
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
        risk: 'destructive',
        safetyReview: 'Preserves the existing VS Code confirmation and domain operation checks.',
        service: 'RuntimeService.deleteRuntime',
        gui: 'Runtime remove',
        availability: 'runtimeIdle',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'removeHandler',
        },
    },
})
