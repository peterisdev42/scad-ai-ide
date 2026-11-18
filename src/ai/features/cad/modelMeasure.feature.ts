import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.modelMeasure',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Measure a verified CAD mesh',
        summary: 'Read basic mesh measurements by existing reportId, or explicitly verify a workspace uri first. Report IDs never recompile missing/expired evidence. Includes snapshot/current status, units, scope and unresolved items. Physical volume is returned only when raw topology, self-intersection, shell composition and winding permit it. Based on exported mesh; no analytic surface, assembly or printability proof. Standalone STL/3MF requires no runtime. Workspace Trust required. For assembly v3 reportId, partIds selects declared frozen parts; no implicit assembly compilation. Assembly total volume is not computed.',
        order: 42,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.modelMeasure',
        name: 'scad_ai_ide_model_measure',
        referenceName: 'scad_model_measure',
        modelDescription: 'Read basic mesh measurements by existing reportId, or explicitly verify a workspace uri first. Report IDs never recompile missing/expired evidence. Includes snapshot/current status, units, scope and unresolved items. Physical volume is returned only when raw topology, self-intersection, shell composition and winding permit it. Based on exported mesh; no analytic surface, assembly or printability proof. Standalone STL/3MF requires no runtime. Workspace Trust required. For assembly v3 reportId, partIds selects declared frozen parts; no implicit assembly compilation. Assembly total volume is not computed.',
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
                measurementTypes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 5,
                    uniqueItems: true,
                    items: {
                        type: 'string',
                        enum: ['bounds', 'surfaceArea', 'signedVolume', 'physicalVolume', 'topology'],
                    },
                },
                objectOffset: {
                    type: 'integer',
                    minimum: 0,
                },
                objectLimit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 20,
                    default: 20,
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
        service: 'MeshWorkspaceService.measure',
        gui: 'CAD: Measure mesh',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'modelMeasureHandler',
        },
    },
})
