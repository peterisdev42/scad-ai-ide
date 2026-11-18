import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.sourceValidate',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'Validate Customizer source',
        summary: 'Read and validate current workspace .scad buffer against optional explicit widget/type/group/default/range/choice expectations. Unlike customizer_state, validates source declarations, not Overrides. Without expectations proves only static consistency. complete=false or semanticPass=false is failure. Runtime and GUI checks are separately notRequested; use existing Preview when requested. Correct diagnostics and validate again. Unmet explicit targets are returned in expectationResults, never as syntax errors or Problems diagnostics. With no expectations, missing Customizer grammar and normal SCAD usage are not diagnostic failures. Inspect sourceStatus, contractStatus, qualityStatus and per-target details; contractStatus=notRequested does not establish a target.',
        order: 39,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'customizer.sourceValidate',
        name: 'scad_ai_ide_customizer_sourceValidate',
        referenceName: 'scad_customizer_sourceValidate',
        modelDescription: 'Read and validate current workspace .scad buffer against optional explicit widget/type/group/default/range/choice expectations. Unlike customizer_state, validates source declarations, not Overrides. Without expectations proves only static consistency. complete=false or semanticPass=false is failure. Runtime and GUI checks are separately notRequested; use existing Preview when requested. Correct diagnostics and validate again. Unmet explicit targets are returned in expectationResults, never as syntax errors or Problems diagnostics. With no expectations, missing Customizer grammar and normal SCAD usage are not diagnostic failures. Inspect sourceStatus, contractStatus, qualityStatus and per-target details; contractStatus=notRequested does not establish a target.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2048,
                },
                expectations: {
                    type: 'array',
                    maxItems: 100,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 128,
                            },
                            widget: {
                                type: 'string',
                                enum: ['slider', 'spinbox', 'dropdown', 'checkbox', 'textbox', 'vector'],
                            },
                            description: {
                                type: 'string',
                                maxLength: 1024,
                            },
                            group: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 128,
                            },
                            range: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    min: {
                                        type: 'number',
                                    },
                                    max: {
                                        type: 'number',
                                    },
                                    step: {
                                        type: 'number',
                                        exclusiveMinimum: 0,
                                    },
                                },
                                required: ['min', 'max'],
                            },
                            choices: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 100,
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        value: {
                                            oneOf: [
                                                {
                                                    type: 'number',
                                                },
                                                {
                                                    type: 'string',
                                                    maxLength: 256,
                                                },
                                            ],
                                        },
                                        label: {
                                            type: 'string',
                                            minLength: 1,
                                            maxLength: 256,
                                        },
                                    },
                                    required: ['value'],
                                },
                            },
                            step: {
                                type: 'number',
                                exclusiveMinimum: 0,
                            },
                            maxLength: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 100000,
                            },
                            type: {
                                type: 'string',
                                enum: ['number', 'string', 'boolean', 'vector'],
                            },
                            defaultValue: {
                                oneOf: [
                                    {
                                        type: 'number',
                                    },
                                    {
                                        type: 'string',
                                        maxLength: 4096,
                                    },
                                    {
                                        type: 'boolean',
                                    },
                                    {
                                        type: 'array',
                                        items: {
                                            type: 'number',
                                        },
                                        minItems: 1,
                                        maxItems: 4,
                                    },
                                ],
                            },
                            requireDescription: {
                                type: 'boolean',
                            },
                            visible: {
                                type: 'boolean',
                            },
                        },
                        required: ['name'],
                    },
                },
                includeWarnings: {
                    type: 'boolean',
                },
            },
            required: ['uri'],
        },
        risk: 'read',
        service: 'CustomizerSourceDomainService.validate',
        gui: 'Problems / Quick Fix',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'sourceValidateHandler',
        },
    },
})
