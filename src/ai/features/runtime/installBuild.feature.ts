import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.runtime.installBuild',
    kind: 'tool',
    group: 'runtime',
    display: {
        label: 'Install exact OpenSCAD build',
        summary: 'Install an exact numeric build ID returned by runtime_builds. Downloads to managed storage; supports cancellation and returns verified discovery state. Requires trust.',
        order: 6,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'runtime.installBuild',
        name: 'scad_ai_ide_runtime_installBuild',
        referenceName: 'scad_runtime_installBuild',
        modelDescription: 'Install an exact numeric build ID returned by runtime_builds. Downloads to managed storage; supports cancellation and returns verified discovery state. Requires trust.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'integer',
                    minimum: 1,
                },
            },
            required: ['id'],
        },
        risk: 'change',
        service: 'RuntimeService.installBuild',
        gui: 'Runtime installBuild',
        availability: 'runtimeIdle',
        binding: {
            module: 'src/ai/handlers/runtime.ts',
            export: 'installBuildHandler',
        },
    },
})
