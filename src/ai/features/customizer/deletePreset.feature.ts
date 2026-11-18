import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.deletePreset',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'deletePreset OpenSCAD presets',
        summary: 'deletePreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Requires independent user confirmation.',
        order: 17,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'customizer.deletePreset',
        name: 'scad_ai_ide_customizer_deletePreset',
        referenceName: 'scad_customizer_deletePreset',
        modelDescription: 'deletePreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Requires independent user confirmation.',
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
            required: ['target', 'revision', 'name'],
        },
        risk: 'destructive',
        safetyReview: 'Preserves the existing VS Code confirmation and domain operation checks.',
        service: 'CustomizerDomainService.preset:delete',
        gui: 'Customizer preset delete',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'deletePresetHandler',
        },
    },
})
