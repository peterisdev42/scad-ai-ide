import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.reset',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'Reset model parameters',
        summary: 'Reset one named parameter or all overrides for exact target/revision. Returns actual values; updates Preview without editing source.',
        order: 13,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'customizer.reset',
        name: 'scad_ai_ide_customizer_reset',
        referenceName: 'scad_customizer_reset',
        modelDescription: 'Reset one named parameter or all overrides for exact target/revision. Returns actual values; updates Preview without editing source.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                target: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
                revision: {
                    type: 'integer',
                    minimum: 0,
                },
                name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: ['target', 'revision'],
        },
        risk: 'change',
        service: 'CustomizerDomainService.reset',
        gui: 'Customizer reset/resetAll command',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'resetHandler',
        },
    },
})
