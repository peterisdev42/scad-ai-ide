import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.exportPresets',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'exportPresets OpenSCAD presets',
        summary: 'exportPresets for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Current-value snapshots must replay without value or type loss; otherwise PRESET_INVALID_VALUE preserves files and state. Exporting existing sets does not validate the current snapshot.',
        order: 19,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'customizer.exportPresets',
        name: 'scad_ai_ide_customizer_exportPresets',
        referenceName: 'scad_customizer_exportPresets',
        modelDescription: 'exportPresets for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Current-value snapshots must replay without value or type loss; otherwise PRESET_INVALID_VALUE preserves files and state. Exporting existing sets does not validate the current snapshot.',
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
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
            },
            required: ['target', 'revision', 'uri'],
        },
        risk: 'change',
        service: 'CustomizerDomainService.preset:export',
        gui: 'Customizer preset export',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'exportPresetsHandler',
        },
    },
})
