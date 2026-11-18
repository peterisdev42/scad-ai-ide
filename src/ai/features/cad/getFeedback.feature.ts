import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.getFeedback',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Read persistent CAD spatial feedback',
        summary: 'Read bounded persistent user feedback and retained baseline identities, revisions and stale state. Provide one owner URI or frozen reportId. Optional targetReportId proposes only provable identical-local-mesh rigid remap candidates; no remap is accepted automatically. Requires Trust.',
        order: 47,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.getFeedback',
        name: 'scad_ai_ide_model_getFeedback',
        referenceName: 'scad_model_getFeedback',
        modelDescription: 'Read bounded persistent user feedback and retained baseline identities, revisions and stale state. Provide one owner URI or frozen reportId. Optional targetReportId proposes only provable identical-local-mesh rigid remap candidates; no remap is accepted automatically. Requires Trust.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
                reportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                },
                snapshotId: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
                status: {
                    enum: ['open', 'resolved', 'stale'],
                },
                targetReportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
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
                    required: ['uri'],
                    not: {
                        required: ['reportId'],
                        properties: {
                            reportId: {},
                        },
                    },
                    properties: {
                        uri: {},
                    },
                },
                {
                    required: ['reportId'],
                    not: {
                        required: ['uri'],
                        properties: {
                            uri: {},
                        },
                    },
                    properties: {
                        reportId: {},
                    },
                },
            ],
        },
        risk: 'read',
        service: 'ReviewWorkspaceService.getFeedback',
        gui: 'CAD review commands / frozen evidence view',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'getFeedbackHandler',
        },
    },
})
