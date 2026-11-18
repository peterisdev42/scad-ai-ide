import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.modelRenderViews',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Render frozen CAD mesh views',
        summary: 'Render the same frozen mesh artifact using official CLI PNG. Supply uri to verify first, or reportId to use existing evidence only. Default iso/front/top 512x512, at most four views. Metadata/artifact delivery by default. Explicit inline uses native image parts within 4 MiB, otherwise metadata fallback. Camera, source/rendered hashes, runtime and display quantization accompany images. Images are display evidence, not visual PASS. Missing runtime/render environment leaves geometry evidence valid. Requires Workspace Trust; no source writes. For assembly v3 reportId, partIds selects declared frozen parts; no implicit assembly compilation. Assembly total volume is not computed.',
        order: 43,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.modelRenderViews',
        name: 'scad_ai_ide_model_renderViews',
        referenceName: 'scad_model_renderViews',
        modelDescription: 'Render the same frozen mesh artifact using official CLI PNG. Supply uri to verify first, or reportId to use existing evidence only. Default iso/front/top 512x512, at most four views. Metadata/artifact delivery by default. Explicit inline uses native image parts within 4 MiB, otherwise metadata fallback. Camera, source/rendered hashes, runtime and display quantization accompany images. Images are display evidence, not visual PASS. Missing runtime/render environment leaves geometry evidence valid. Requires Workspace Trust; no source writes. For assembly v3 reportId, partIds selects declared frozen parts; no implicit assembly compilation. Assembly total volume is not computed.',
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
                projectRoot: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
                expectedSnapshotId: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
                quality: {
                    type: 'string',
                    enum: ['verification'],
                },
                units: {
                    type: 'string',
                    enum: ['mm'],
                },
                requireNonEmpty: {
                    type: 'boolean',
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
                cameras: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 4,
                    items: {
                        oneOf: [
                            {
                                type: 'string',
                                enum: ['iso', 'front', 'top', 'right'],
                            },
                            {
                                type: 'object',
                                additionalProperties: false,
                                required: ['eye', 'target'],
                                properties: {
                                    eye: {
                                        type: 'array',
                                        minItems: 3,
                                        maxItems: 3,
                                        items: {
                                            type: 'number',
                                        },
                                    },
                                    target: {
                                        type: 'array',
                                        minItems: 3,
                                        maxItems: 3,
                                        items: {
                                            type: 'number',
                                        },
                                    },
                                    projection: {
                                        type: 'string',
                                        enum: ['orthographic', 'perspective'],
                                    },
                                },
                            },
                        ],
                    },
                },
                imageSize: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 2,
                    items: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 1024,
                    },
                },
                delivery: {
                    type: 'string',
                    enum: ['metadata', 'inline'],
                    default: 'metadata',
                },
                partIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    uniqueItems: true,
                    items: {
                        type: 'string',
                        maxLength: 64,
                    },
                },
            },
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
                        anyOf: [
                            {
                                required: ['uri'],
                                properties: {
                                    uri: {},
                                },
                            },
                            {
                                required: ['projectRoot'],
                                properties: {
                                    projectRoot: {},
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
                                required: ['units'],
                                properties: {
                                    units: {},
                                },
                            },
                            {
                                required: ['requireNonEmpty'],
                                properties: {
                                    requireNonEmpty: {},
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
                    properties: {
                        reportId: {},
                    },
                },
            ],
        },
        risk: 'read',
        service: 'MeshWorkspaceService.renderViews',
        gui: 'CAD: Render frozen mesh views',
        resultFormat: 'inlineViews',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'modelRenderViewsHandler',
        },
    },
})
