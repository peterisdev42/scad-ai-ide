import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.compare',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Compare frozen CAD evidence',
        summary: 'Compare existing v2/v3 reports or explicitly retained baselines, without compilation. Stable identity is Manifest URI + declared partId, or whole document URI for v2. Summaries only; exported mesh changes do not prove local-region preservation. Required constraint removal/changes never count as repair. Optional expectUnchangedPartIds protects whole local mesh and assembly pose. Requires Trust. To CREATE a comparison, pass baselineReportId AND targetReportId. reportId ONLY reads a comparison report returned by this tool; never put a v2/v3 model ID there.',
        order: 46,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.compare',
        name: 'scad_ai_ide_model_compare',
        referenceName: 'scad_model_compare',
        modelDescription: 'Compare existing v2/v3 reports or explicitly retained baselines, without compilation. Stable identity is Manifest URI + declared partId, or whole document URI for v2. Summaries only; exported mesh changes do not prove local-region preservation. Required constraint removal/changes never count as repair. Optional expectUnchangedPartIds protects whole local mesh and assembly pose. Requires Trust. To CREATE a comparison, pass baselineReportId AND targetReportId. reportId ONLY reads a comparison report returned by this tool; never put a v2/v3 model ID there.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                reportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                    description: 'Read a prior comparison result only; not a source v2/v3 model ID.',
                },
                baselineReportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                    description: 'Frozen v2/v3 model report ID used as the before baseline. Required together with targetReportId to create a comparison.',
                },
                targetReportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                    description: 'Frozen v2/v3 model report ID used as the after target. Required together with baselineReportId.',
                },
                expectUnchangedPartIds: {
                    type: 'array',
                    uniqueItems: true,
                    maxItems: 32,
                    items: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 128,
                    },
                },
                section: {
                    enum: ['parts', 'checks', 'issues'],
                },
                offset: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: [],
            oneOf: [
                {
                    required: ['reportId'],
                    not: {
                        anyOf: [
                            {
                                required: ['baselineReportId'],
                                properties: {
                                    baselineReportId: {},
                                },
                            },
                            {
                                required: ['targetReportId'],
                                properties: {
                                    targetReportId: {},
                                },
                            },
                            {
                                required: ['expectUnchangedPartIds'],
                                properties: {
                                    expectUnchangedPartIds: {},
                                },
                            },
                        ],
                    },
                    properties: {
                        reportId: {},
                    },
                },
                {
                    required: ['baselineReportId', 'targetReportId'],
                    not: {
                        required: ['reportId'],
                        properties: {
                            reportId: {},
                        },
                    },
                    properties: {
                        baselineReportId: {},
                        targetReportId: {},
                    },
                },
            ],
        },
        risk: 'read',
        service: 'ReviewWorkspaceService.compare',
        gui: 'CAD review commands / frozen evidence view',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'compareHandler',
        },
    },
})
