import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.modelPreviewLink',
    kind: 'tool',
    group: 'cad',
    display: {
        label: 'Get interactive OpenSCAD model preview link',
        summary: 'Create a clickable chat link that opens a workspace .scad file in the interactive OpenSCAD Preview editor.',
        order: 54,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.modelPreviewLink',
        name: 'scad_ai_ide_model_previewLink',
        referenceName: 'scad_model_previewLink',
        modelDescription: 'Use after creating or editing a .scad model and whenever offering an interactive model preview in chat. Supply the existing workspace .scad file URI. Include the returned markdownLink in your answer as a clickable link. Localize the label as needed and copy the URL exactly. The editor opens when the user clicks. Label any PNG links as rendered images.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                uri: { type: 'string', minLength: 1, maxLength: 4096 },
            },
            required: ['uri'],
        },
        risk: 'read',
        service: 'PreviewLinks.create',
        gui: 'OpenSCAD Preview editor (via chat link)',
        binding: {
            module: 'src/ai/handlers/cad.ts',
            export: 'modelPreviewLinkHandler',
        },
    },
})
