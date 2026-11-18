import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.checkPrintability',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Screen explicit CAD print setup',
        summary: 'Screen one frozen mesh against an explicit local mm FDM profile: build envelope and numerical overhang triangle candidates only. No thickness, bridges, support, slicer or manufacturing guarantee; printability remains NOT_CHECKED. For v3 choose partId; uses local geometry and print pose, ignoring assembly pose. Existing print assessment reportId reads only. No automatic unit assumption or source compilation. Requires Trust.',
        order: 49,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.checkPrintability',
        name: 'scad_ai_ide_model_checkPrintability',
        referenceName: 'scad_model_checkPrintability',
        modelDescription: 'Screen one frozen mesh against an explicit local mm FDM profile: build envelope and numerical overhang triangle candidates only. No thickness, bridges, support, slicer or manufacturing guarantee; printability remains NOT_CHECKED. For v3 choose partId; uses local geometry and print pose, ignoring assembly pose. Existing print assessment reportId reads only. No automatic unit assumption or source compilation. Requires Trust.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                reportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                },
                profileUri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
                partId: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 128,
                },
                expectedProfileDigest: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
            },
            required: ['reportId'],
        },
        risk: 'read',
        service: 'ReviewWorkspaceService.checkPrintability',
        gui: 'CAD review commands / frozen evidence view',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'checkPrintabilityHandler',
        },
    },
})
