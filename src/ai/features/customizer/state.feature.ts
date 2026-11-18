import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.state',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'Read model Customizer',
        summary: 'Read active model target URI, revision, complete parameter types/ranges/default/current values and preset status. Overrides do not edit SCAD source; no panel required.',
        order: 11,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'customizer.state',
        name: 'scad_ai_ide_customizer_state',
        referenceName: 'scad_customizer_state',
        modelDescription: 'Read active model target URI, revision, complete parameter types/ranges/default/current values and preset status. Overrides do not edit SCAD source; no panel required.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
        },
        risk: 'read',
        service: 'CustomizerDomainService.snapshot',
        gui: 'Customizer parameter tree/preset selector',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'stateHandler',
        },
    },
})
