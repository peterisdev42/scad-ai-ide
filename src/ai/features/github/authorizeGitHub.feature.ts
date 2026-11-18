import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.more.authorizeGitHub',
    kind: 'tool',
    group: 'github',
    display: {
        label: 'Authorize GitHub access',
        summary: 'Start real interactive VS Code GitHub authentication. User must complete Accounts flow. Returns safe status only; no access token is exposed. Anonymous access remains available.',
        order: 32,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'more.authorizeGitHub',
        name: 'scad_ai_ide_more_authorizeGitHub',
        referenceName: 'scad_more_authorizeGitHub',
        modelDescription: 'Start real interactive VS Code GitHub authentication. User must complete Accounts flow. Returns safe status only; no access token is exposed. Anonymous access remains available.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
        },
        risk: 'change',
        service: 'GitHub.connect',
        gui: 'More authorize/connect command',
        binding: {
            module: 'src/ai/handlers/github.ts',
            export: 'authorizeGitHubHandler',
        },
    },
})
