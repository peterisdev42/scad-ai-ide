import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.customizer.sourceAnalyze',
    kind: 'tool',
    group: 'customizer',
    display: {
        label: 'Analyze Customizer source',
        summary: 'Analyze Customizer declarations in an explicit workspace .scad URI, including unsaved editor text. Returns source version/hash, actual widgets, ranges, candidates and bounded diagnostics; complete=false is not success. Unlike customizer_state this reads source, not Overrides. Analyze before sourceApply; correct invalid inputs or unsupported forms rather than guessing.',
        order: 37,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'customizer.sourceAnalyze',
        name: 'scad_ai_ide_customizer_sourceAnalyze',
        referenceName: 'scad_customizer_sourceAnalyze',
        modelDescription: 'Analyze Customizer declarations in an explicit workspace .scad URI, including unsaved editor text. Returns source version/hash, actual widgets, ranges, candidates and bounded diagnostics; complete=false is not success. Unlike customizer_state this reads source, not Overrides. Analyze before sourceApply; correct invalid inputs or unsupported forms rather than guessing.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                uri: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2048,
                },
                includeCandidates: {
                    type: 'boolean',
                },
                maxDiagnostics: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 100,
                },
            },
            required: ['uri'],
        },
        risk: 'read',
        service: 'CustomizerSourceDomainService.analyze',
        gui: 'Problems / Quick Fix',
        binding: {
            module: 'src/ai/handlers/customizer.ts',
            export: 'sourceAnalyzeHandler',
        },
    },
})
