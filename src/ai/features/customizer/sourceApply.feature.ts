import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.sourceApply',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'Plan or commit Customizer source edits',
        summary: 'Author Customizer SOURCE, not runtime Overrides: plan bounded literal/annotation/group edits with sourceAnalyze version/hash, inspect preview, then commit the single-use planId within 120 seconds. Successful plans return data.continuation: review the diff and invoke its registered tool with its input unchanged (mode and planId only). requiresReview is guidance, never authorization or a Commit input field. Requires Workspace Trust and commit confirmation; never accepts model approval. Writes only the buffer, never saves. On STALE_SOURCE reanalyze and replan; on NEEDS_MANUAL_REVIEW stop unchanged-source retries, use ordinary editor changes only if the user task permits them, otherwise explain manual handling. Check applied AND semanticPass/postValidation; never claim success after failure.',
        order: 38,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'customizer.sourceApply',
        name: 'scad_ai_ide_customizer_sourceApply',
        referenceName: 'scad_customizer_sourceApply',
        modelDescription: 'Author Customizer SOURCE, not runtime Overrides: plan bounded literal/annotation/group edits with sourceAnalyze version/hash, inspect preview, then commit the single-use planId within 120 seconds. Successful plans return data.continuation: review the diff and invoke its registered tool with its input unchanged (mode and planId only). requiresReview is guidance, never authorization or a Commit input field. Requires Workspace Trust and commit confirmation; never accepts model approval. Writes only the buffer, never saves. On STALE_SOURCE reanalyze and replan; on NEEDS_MANUAL_REVIEW stop unchanged-source retries, use ordinary editor changes only if the user task permits them, otherwise explain manual handling. Check applied AND semanticPass/postValidation; never claim success after failure.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                mode: {
                    type: 'string',
                    enum: ['plan', 'commit'],
                    description: 'plan requires uri, identity.version, identity.sha256 and edits; commit requires only planId. Copy identity and planId from actual previous results.',
                },
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2048,
                },
                identity: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        version: {
                            type: 'integer',
                            minimum: 1,
                        },
                        sha256: {
                            type: 'string',
                            pattern: '^[a-f0-9]{64}$',
                        },
                    },
                    required: ['version', 'sha256'],
                    description: 'Nested object copied from sourceAnalyze data.identity: version is a number and sha256 is a string. Do not send version or sha256 as root fields.',
                },
                edits: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 50,
                    items: {
                        oneOf: [
                            {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    kind: {
                                        const: 'annotateExisting',
                                    },
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
                                },
                                required: ['kind', 'name', 'widget'],
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    kind: {
                                        const: 'insertLiteralParameter',
                                    },
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
                                },
                                required: ['kind', 'name', 'widget', 'defaultValue'],
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    kind: {
                                        const: 'changeWidget',
                                    },
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
                                },
                                required: ['kind', 'name', 'widget'],
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    kind: {
                                        const: 'moveGroup',
                                    },
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 128,
                                    },
                                    group: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 128,
                                    },
                                },
                                required: ['kind', 'name', 'group'],
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    kind: {
                                        const: 'hideParameter',
                                    },
                                    name: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 128,
                                    },
                                },
                                required: ['kind', 'name'],
                            },
                        ],
                    },
                    description: 'Array of intent DATA objects. Each has one exact kind and name, with the fields required by that kind. Do not send JSON Schema keywords or a shell command.',
                },
                planId: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 128,
                    description: 'Opaque ID from a successful sourceApply mode=plan data.planId. Never use sourceAnalyze operation.id.',
                },
            },
            required: ['mode'],
            oneOf: [
                {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        mode: {
                            const: 'plan',
                        },
                        uri: {},
                        identity: {},
                        edits: {},
                    },
                    required: ['mode', 'uri', 'identity', 'edits'],
                },
                {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        mode: {
                            const: 'commit',
                        },
                        planId: {},
                    },
                    required: ['mode', 'planId'],
                },
            ],
        },
        risk: 'change',
        service: 'CustomizerSourceDomainService.apply',
        gui: 'Problems / Quick Fix',
        serviceConfirmation: true,
        availability: 'customizerIdle',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'sourceApplyHandler',
        },
    },
})
