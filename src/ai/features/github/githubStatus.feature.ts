import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.more.githubStatus',
    kind: 'tool',
    group: 'github',
    display: {
        label: 'Read GitHub connection status',
        summary: 'Refresh silently and read GitHub mode/account label/rate-limit hint only. Never returns tokens or session objects.',
        order: 31,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'more.githubStatus',
        name: 'scad_ai_ide_more_githubStatus',
        referenceName: 'scad_more_githubStatus',
        modelDescription: 'Refresh silently and read GitHub mode/account label/rate-limit hint only. Never returns tokens or session objects.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
        },
        risk: 'read',
        service: 'GitHub.getState/refresh',
        gui: 'More GitHub status',
        binding: {
            module: 'src/ai/handlers/github.ts',
            export: 'githubStatusHandler',
        },
    },
})
