import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.capabilities.discover',
    kind: 'tool',
    group: 'discovery',
    display: {
        label: 'Discover OpenSCAD capabilities',
        summary: 'Discover live availability, constraints and tool names for Runtime, Libraries, Customizer and diagnostics. No changes; returns bounded capability metadata.',
        order: 0,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'capabilities.discover',
        name: 'scad_ai_ide_capabilities_discover',
        referenceName: 'scad_capabilities_discover',
        modelDescription: 'Discover live availability, constraints and tool names for Runtime, Libraries, Customizer and diagnostics. No changes; returns bounded capability metadata.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                offset: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: [],
        },
        risk: 'read',
        service: 'FeaturePolicyEngine',
        gui: 'AI Panel capability tables / Refresh availability',
        binding: {
            module: 'src/ai/handlers/discovery.ts',
            export: 'discoverHandler',
        },
    },
})
