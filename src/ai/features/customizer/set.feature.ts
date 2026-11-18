import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.set',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'Set model parameters atomically',
        summary: 'Set validated parameter overrides atomically on the exact target/revision from customizer_state. Values must match parameter schema. Updates GUI/Preview; does not edit SCAD source.',
        order: 12,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'customizer.set',
        name: 'scad_ai_ide_customizer_set',
        referenceName: 'scad_customizer_set',
        modelDescription: 'Set validated parameter overrides atomically on the exact target/revision from customizer_state. Values must match parameter schema. Updates GUI/Preview; does not edit SCAD source.',
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
                values: {
                    type: 'object',
                    minProperties: 1,
                    maxProperties: 100,
                    propertyNames: {
                        pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$',
                    },
                    additionalProperties: {
                        anyOf: [
                            {
                                type: 'string',
                                maxLength: 10000,
                            },
                            {
                                type: 'number',
                            },
                            {
                                type: 'boolean',
                            },
                            {
                                type: 'array',
                                items: {
                                    type: 'number',
                                },
                                maxItems: 4,
                                minItems: 1,
                            },
                        ],
                    },
                },
            },
            required: ['target', 'revision', 'values'],
        },
        risk: 'change',
        service: 'CustomizerDomainService.setValues',
        gui: 'Customizer set',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'setHandler',
        },
    },
})
