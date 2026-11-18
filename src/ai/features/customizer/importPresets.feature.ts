import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.importPresets',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'importPresets OpenSCAD presets',
        summary: 'importPresets for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Import does not apply a set. Unknown versions are preserved for read-only analysis; apply and writes require verified compatibility.',
        order: 18,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'customizer.importPresets',
        name: 'scad_ai_ide_customizer_importPresets',
        referenceName: 'scad_customizer_importPresets',
        modelDescription: 'importPresets for exact target URI and revision from customizer_state. Named presets use existing OpenSCAD JSON format; explicit file URIs must be inside the host workspace. Returns verified parameter/preset state; preserves other presets and metadata. Import does not apply a set. Unknown versions are preserved for read-only analysis; apply and writes require verified compatibility.',
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
        service: 'CustomizerDomainService.preset:import',
        gui: 'Customizer preset import',
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'importPresetsHandler',
        },
    },
})
