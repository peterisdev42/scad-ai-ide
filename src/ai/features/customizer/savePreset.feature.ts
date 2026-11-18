import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.savePreset',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'savePreset OpenSCAD presets',
        summary: 'savePreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Current-value snapshots must replay without value or type loss; otherwise PRESET_INVALID_VALUE preserves files and state.',
        order: 16,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'customizer.savePreset',
        name: 'scad_ai_ide_customizer_savePreset',
        referenceName: 'scad_customizer_savePreset',
        modelDescription: 'savePreset for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Current-value snapshots must replay without value or type loss; otherwise PRESET_INVALID_VALUE preserves files and state.',
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
            required: ['target', 'revision'],
        },
        risk: 'change',
        service: 'CustomizerDomainService.preset:save',
        gui: 'Customizer preset save',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'savePresetHandler',
        },
    },
})
