import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.issueDetails',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Read OpenSCAD CAD issue evidence',
        summary: 'Read one issue from a specific analysis report. Optional bounded local CLI evidence; includes runtime, snapshot ID and whether the report is still current. Expired reports are not recomputed implicitly. Historical results are evidence only; analyze the current document before claiming a repair. No source writes or CLI execution. Geometry v2 includes bounded triangle/component/spatial evidence and pagination. Binary mesh issues have model-level positions, never invented source lines.',
        order: 41,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.issueDetails',
        name: 'scad_ai_ide_model_getIssue',
        referenceName: 'scad_model_getIssue',
        modelDescription: 'Read one issue from a specific analysis report. Optional bounded local CLI evidence; includes runtime, snapshot ID and whether the report is still current. Expired reports are not recomputed implicitly. Historical results are evidence only; analyze the current document before claiming a repair. No source writes or CLI execution. Geometry v2 includes bounded triangle/component/spatial evidence and pagination. Binary mesh issues have model-level positions, never invented source lines.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                reportId: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 128,
                },
                issueId: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                },
                includeEvidence: {
                    type: 'boolean',
                    default: false,
                },
                cursor: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 200,
                },
            },
            required: ['reportId', 'issueId'],
        },
        risk: 'read',
        service: 'CadWorkspaceService.issueDetails',
        gui: 'CAD report / issue evidence',
        availability: 'cadReport',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'issueDetailsHandler',
        },
    },
})
