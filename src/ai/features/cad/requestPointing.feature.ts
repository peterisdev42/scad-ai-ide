import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.requestPointing',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Ask user for CAD surface feedback',
        summary: 'Open a frozen evidence view and wait for a human to select a surface and explicitly submit, or confirm a proven remap candidate. No source modification; no synthetic coordinates accepted. Current snapshot required, model PASS not required. Default timeout120s, max240s. User cancellation/timeout creates no feedback. Requires graphical interaction and Trust.',
        order: 48,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.requestPointing',
        name: 'scad_ai_ide_model_requestPointing',
        referenceName: 'scad_model_requestPointing',
        modelDescription: 'Open a frozen evidence view and wait for a human to select a surface and explicitly submit, or confirm a proven remap candidate. No source modification; no synthetic coordinates accepted. Current snapshot required, model PASS not required. Default timeout120s, max240s. User cancellation/timeout creates no feedback. Requires graphical interaction and Trust.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                reportId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                },
                prompt: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 1024,
                },
                ttl: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 240,
                },
                remapCandidateId: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
                feedbackId: {
                    type: 'string',
                    pattern: '^cad-[a-f0-9-]{36}$',
                },
            },
            required: ['reportId', 'prompt'],
            dependencies: {
                remapCandidateId: ['feedbackId'],
                feedbackId: ['remapCandidateId'],
            },
        },
        risk: 'read',
        requiresInteraction: true,
        service: 'ReviewWorkspaceService.requestPointing',
        gui: 'CAD review commands / frozen evidence view',
        availability: 'pointing',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'requestPointingHandler',
        },
    },
})
