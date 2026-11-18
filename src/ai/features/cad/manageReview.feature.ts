import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.manageReview',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Manage retained CAD review evidence',
        summary: 'Explicitly retain/release a frozen baseline, or resolve/reopen/delete user feedback using its current revision. Changes local review records only, never geometry or constraints. Resolved feedback does not imply model PASS. Retained geometry persists across restart; bounded capacity has no silent eviction. Requires Trust.',
        order: 50,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.manageReview',
        name: 'scad_ai_ide_model_manageReview',
        referenceName: 'scad_model_manageReview',
        modelDescription: 'Explicitly retain/release a frozen baseline, or resolve/reopen/delete user feedback using its current revision. Changes local review records only, never geometry or constraints. Resolved feedback does not imply model PASS. Retained geometry persists across restart; bounded capacity has no silent eviction. Requires Trust.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                action: {
                    enum: ['retainBaseline', 'releaseBaseline', 'resolveFeedback', 'reopenFeedback', 'deleteFeedback'],
                },
                reportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                },
                feedbackId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                },
                expectedRevision: {
                    type: 'integer',
                    minimum: 1,
                },
                label: {
                    type: 'string',
                    maxLength: 128,
                },
            },
            required: ['action'],
            oneOf: [
                {
                    properties: {
                        action: {
                            enum: ['retainBaseline', 'releaseBaseline'],
                        },
                        reportId: {},
                    },
                    required: ['reportId'],
                    not: {
                        anyOf: [
                            {
                                required: ['feedbackId'],
                                properties: {
                                    feedbackId: {},
                                },
                            },
                            {
                                required: ['expectedRevision'],
                                properties: {
                                    expectedRevision: {},
                                },
                            },
                        ],
                    },
                },
                {
                    properties: {
                        action: {
                            enum: ['resolveFeedback', 'reopenFeedback', 'deleteFeedback'],
                        },
                        feedbackId: {},
                        expectedRevision: {},
                    },
                    required: ['feedbackId', 'expectedRevision'],
                    not: {
                        anyOf: [
                            {
                                required: ['reportId'],
                                properties: {
                                    reportId: {},
                                },
                            },
                            {
                                required: ['label'],
                                properties: {
                                    label: {},
                                },
                            },
                        ],
                    },
                },
            ],
        },
        risk: 'change',
        service: 'ReviewWorkspaceService.manageReview',
        gui: 'CAD review commands / frozen evidence view',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'manageReviewHandler',
        },
    },
})
