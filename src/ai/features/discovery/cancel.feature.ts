import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.operation.cancel',
    kind: 'tool',
    group: 'discovery',
    display: {
        label: 'Cancel OpenSCAD operation',
        summary: 'Cancel one Agent operation by exact id, OR request cancellation of the current Runtime installation / Library task by domain=runtime|libraries, including tasks started in the GUI. Choose exactly one. Returns cancellationRequested, not proof the task stopped: re-read domain state or operation status; critical transactions may finish.',
        order: 2,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'operation.cancel',
        name: 'scad_ai_ide_operation_cancel',
        referenceName: 'scad_operation_cancel',
        modelDescription: 'Cancel one Agent operation by exact id, OR request cancellation of the current Runtime installation / Library task by domain=runtime|libraries, including tasks started in the GUI. Choose exactly one. Returns cancellationRequested, not proof the task stopped: re-read domain state or operation status; critical transactions may finish.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
                domain: {
                    type: 'string',
                    enum: ['runtime', 'libraries'],
                },
            },
            oneOf: [
                {
                    properties: {
                        id: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 512,
                        },
                    },
                    required: ['id'],
                },
                {
                    properties: {
                        domain: {
                            type: 'string',
                            enum: ['runtime', 'libraries'],
                        },
                    },
                    required: ['domain'],
                },
            ],
        },
        risk: 'change',
        service: 'OperationTracker.cancel',
        gui: 'cancel buttons',
        binding: {
            module: 'src/ai/handlers/discovery.ts',
            export: 'cancelHandler',
        },
    },
})
