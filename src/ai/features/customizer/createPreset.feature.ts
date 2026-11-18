import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.createPreset',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'createPreset OpenSCAD presets',
        summary: 'createPreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Current-value snapshots must replay without value or type loss; otherwise PRESET_INVALID_VALUE preserves files and state.',
        order: 15,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'customizer.createPreset',
        name: 'scad_ai_ide_customizer_createPreset',
        referenceName: 'scad_customizer_createPreset',
        modelDescription: 'createPreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Current-value snapshots must replay without value or type loss; otherwise PRESET_INVALID_VALUE preserves files and state.',
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
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
            },
            required: ['target', 'revision', 'name'],
        },
        risk: 'change',
        service: 'CustomizerDomainService.preset:new',
        gui: 'Customizer preset new',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'createPresetHandler',
        },
    },
})
