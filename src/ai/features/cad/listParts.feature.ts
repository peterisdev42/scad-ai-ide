import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.listParts',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'List declared CAD parts and constraints',
        summary: 'Read optional .scad/verification.json declarations or an existing v3 report without compiling. Returns stable author IDs scoped to canonical Manifest URI, manifestDigest for repair baseline, and paginated parts/checks. Relative entries resolve from project root (parent of .scad). Missing Manifest returns UNRESOLVED NO_STABLE_PARTS. Requires Workspace Trust.',
        order: 44,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.listParts',
        name: 'scad_ai_ide_model_listParts',
        referenceName: 'scad_model_listParts',
        modelDescription: 'Read optional .scad/verification.json declarations or an existing v3 report without compiling. Returns stable author IDs scoped to canonical Manifest URI, manifestDigest for repair baseline, and paginated parts/checks. Relative entries resolve from project root (parent of .scad). Missing Manifest returns UNRESOLVED NO_STABLE_PARTS. Requires Workspace Trust.',
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
                section: {
                    enum: ['parts', 'checks'],
                    default: 'parts',
                },
                offset: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 32,
                },
                includeHints: {
                    type: 'boolean',
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
                        required: ['uri'],
                        properties: {
                            uri: {},
                        },
                    },
                },
            ],
        },
        risk: 'read',
        service: 'AssemblyWorkspaceService.list',
        gui: 'CAD commands',
        availability: 'cad',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'listPartsHandler',
        },
    },
})
