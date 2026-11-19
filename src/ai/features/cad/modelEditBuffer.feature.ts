import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.cad.modelEditBuffer',
    kind: 'tool',
    group: 'cad',
    display: { label: 'Plan or apply a CAD buffer edit', summary: 'Plan one exact, unique text replacement in an open dirty workspace SCAD buffer using document.version and document.sourceSha256 from diagnostics. Review the preview, then call the returned commit continuation. Commit requires a separate VS Code Apply decision, consumes the plan, and never saves files. Requires Workspace Trust and Auto Save off.', order: 52 },
    control: { enabledByDefault: true, userConfigurable: true, scope: 'application' },
    requiresTrust: true,
    tool: {
        capabilityId: 'cad.modelEditBuffer',
        name: 'scad_ai_ide_model_editBuffer',
        referenceName: 'scad_model_editBuffer',
        modelDescription: 'Plan one exact, unique text replacement in an open dirty workspace SCAD buffer using document.version and document.sourceSha256 from diagnostics. Review the preview, then call the returned commit continuation. Commit requires a separate VS Code Apply decision, consumes the plan, and never saves files. Requires Workspace Trust and Auto Save off.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                mode: { type: 'string', enum: ['plan', 'commit'] },
                uri: { type: 'string', minLength: 1, maxLength: 4096 },
                identity: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        version: { type: 'integer', minimum: 0 },
                        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                    },
                    required: ['version', 'sha256'],
                },
                oldText: { type: 'string', minLength: 1, maxLength: 2048 },
                newText: { type: 'string', maxLength: 2048 },
                planId: { type: 'string', minLength: 1, maxLength: 128 },
            },
            required: ['mode'],
            oneOf: [
                { type: 'object', additionalProperties: false, properties: { mode: { const: 'plan' }, uri: {}, identity: {}, oldText: {}, newText: {} }, required: ['mode', 'uri', 'identity', 'oldText', 'newText'] },
                { type: 'object', additionalProperties: false, properties: { mode: { const: 'commit' }, planId: {} }, required: ['mode', 'planId'] },
            ],
        },
        risk: 'change',
        serviceConfirmation: true,
        service: 'CadBufferEditService.apply',
        gui: 'Text editor buffer',
        binding: { module: 'src/ai/handlers/cad.ts', export: 'modelEditBufferHandler' },
    },
})
