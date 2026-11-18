import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.operation.status',
    kind: 'tool',
    group: 'discovery',
    display: {
        label: 'Inspect OpenSCAD operations',
        summary: 'Poll a specific operation ID or list recent operations. Returns running/terminal state and progress message, no changes.',
        order: 1,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'operation.status',
        name: 'scad_ai_ide_operation_status',
        referenceName: 'scad_operation_status',
        modelDescription: 'Poll a specific operation ID or list recent operations. Returns running/terminal state and progress message, no changes.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
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
        service: 'OperationTracker.status',
        gui: 'progress indicators',
        binding: {
            module: 'src/ai/handlers/discovery.ts',
            export: 'statusHandler',
        },
    },
})
