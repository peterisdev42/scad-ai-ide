import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.applyPreset',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'applyPreset OpenSCAD presets',
        summary: 'applyPreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Empty name applies design defaults. Overrides do not edit source. Each selection starts from design defaults plus this set, clearing prior set Overrides. Unverified file versions are read-only.',
        order: 14,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'customizer.applyPreset',
        name: 'scad_ai_ide_customizer_applyPreset',
        referenceName: 'scad_customizer_applyPreset',
        modelDescription: 'applyPreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Empty name applies design defaults. Overrides do not edit source. Each selection starts from design defaults plus this set, clearing prior set Overrides. Unverified file versions are read-only.',
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
                    maxLength: 512,
                },
            },
            required: ['target', 'revision', 'name'],
        },
        risk: 'change',
        service: 'CustomizerDomainService.preset:select',
        gui: 'Customizer preset select',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'applyPresetHandler',
        },
    },
})
