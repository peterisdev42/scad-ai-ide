import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.checkAssembly',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Check static CAD assembly constraints',
        summary: 'Freeze every declared part and validate all required raw-solid prerequisites and Manifest constraints in one snapshot. URI executes; reportId only reads existing evidence. expectedManifestDigest locks the repair baseline; pairIds can add geometric pair queries but cannot replace or override required checks. Distances are conservative intervals on frozen exported meshes. No overlap-volume, repair, motion or printability check. Requires Workspace Trust.',
        order: 45,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.checkAssembly',
        name: 'scad_ai_ide_model_checkAssembly',
        referenceName: 'scad_model_checkAssembly',
        modelDescription: 'Freeze every declared part and validate all required raw-solid prerequisites and Manifest constraints in one snapshot. URI executes; reportId only reads existing evidence. expectedManifestDigest locks the repair baseline; pairIds can add geometric pair queries but cannot replace or override required checks. Distances are conservative intervals on frozen exported meshes. No overlap-volume, repair, motion or printability check. Requires Workspace Trust.',
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
                    minLength: 1,
                    maxLength: 128,
                },
                pairIds: {
                    type: 'array',
                    maxItems: 512,
                    uniqueItems: true,
                    items: {
                        type: 'string',
                        pattern: '^[a-f0-9]{64}$',
                    },
                },
                expectedManifestDigest: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
                expectedSnapshotId: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
                quality: {
                    enum: ['verification'],
                },
                tessellation: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        fn: {
                            type: 'integer',
                            minimum: 0,
                            maximum: 10000,
                        },
                        fa: {
                            type: 'number',
                            exclusiveMinimum: 0,
                            maximum: 360,
                        },
                        fs: {
                            type: 'number',
                            exclusiveMinimum: 0,
                        },
                    },
                },
            },
            oneOf: [
                {
                    required: ['uri'],
                    properties: {
                        uri: {},
                    },
                    not: {
                        required: ['reportId'],
                        properties: {
                            reportId: {},
                        },
                    },
                },
                {
                    required: ['reportId'],
                    properties: {
                        reportId: {},
                    },
                    not: {
                        anyOf: [
                            {
                                required: ['uri'],
                                properties: {
                                    uri: {},
                                },
                            },
                            {
                                required: ['pairIds'],
                                properties: {
                                    pairIds: {},
                                },
                            },
                            {
                                required: ['expectedManifestDigest'],
                                properties: {
                                    expectedManifestDigest: {},
                                },
                            },
                            {
                                required: ['expectedSnapshotId'],
                                properties: {
                                    expectedSnapshotId: {},
                                },
                            },
                            {
                                required: ['quality'],
                                properties: {
                                    quality: {},
                                },
                            },
                            {
                                required: ['tessellation'],
                                properties: {
                                    tessellation: {},
                                },
                            },
                        ],
                    },
                },
            ],
        },
        risk: 'read',
        service: 'AssemblyWorkspaceService.check',
        gui: 'scad-ai-ide.model.checkAssembly',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'checkAssemblyHandler',
        },
    },
})
