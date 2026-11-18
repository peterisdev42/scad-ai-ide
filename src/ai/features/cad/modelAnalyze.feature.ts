import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.modelAnalyze',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Analyze CAD diagnostics or verify raw mesh',
        summary: 'Analyze an explicit workspace URI without Preview. Default diagnostics preserves SCAD/CSG CLI diagnostics. mode=verify Full Renders SCAD/CSG to frozen STL or audits standalone STL/3MF without a runtime. Returns snapshot-bound raw format/topology/intersection/shell checks and mesh measurements. Requires Workspace Trust. No source writes, mesh repair, assembly or printability proof. Read units, completeness and UNRESOLVED checks; ok:true means a report was returned, not PASS. After edits analyze again. SCAD and PNG require the selected official CLI.',
        order: 40,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.modelAnalyze',
        name: 'scad_ai_ide_model_analyze',
        referenceName: 'scad_model_analyze',
        modelDescription: 'Analyze an explicit workspace URI without Preview. Default diagnostics preserves SCAD/CSG CLI diagnostics. mode=verify Full Renders SCAD/CSG to frozen STL or audits standalone STL/3MF without a runtime. Returns snapshot-bound raw format/topology/intersection/shell checks and mesh measurements. Requires Workspace Trust. No source writes, mesh repair, assembly or printability proof. Read units, completeness and UNRESOLVED checks; ok:true means a report was returned, not PASS. After edits analyze again. SCAD and PNG require the selected official CLI.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
                mode: {
                    type: 'string',
                    enum: ['diagnostics', 'verify'],
                    default: 'diagnostics',
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
            },
            required: ['uri'],
            allOf: [
                {
                    if: {
                        properties: {
                            mode: {
                                const: 'verify',
                            },
                        },
                        required: ['mode'],
                    },
                    then: {},
                    else: {
                        not: {
                            anyOf: [
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
                    },
                },
            ],
        },
        risk: 'read',
        service: 'CadWorkspaceService / MeshWorkspaceService',
        gui: 'CAD diagnostics / Verify raw mesh',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'modelAnalyzeHandler',
        },
    },
})
