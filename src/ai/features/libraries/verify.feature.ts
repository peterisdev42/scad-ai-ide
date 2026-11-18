import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.verify',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Verify global library cache',
        summary: 'Verify one exact cache key or all cached versions. Checks local inventory corruption, not independent supply-chain authenticity. Returns actual failures, trust required.',
        order: 27,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    requiresTrust: true,
    tool: {
        capabilityId: 'libraries.verify',
        name: 'scad_ai_ide_libraries_verify',
        referenceName: 'scad_libraries_verify',
        modelDescription: 'Verify one exact cache key or all cached versions. Checks local inventory corruption, not independent supply-chain authenticity. Returns actual failures, trust required.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                key: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            required: [],
        },
        risk: 'read',
        service: 'LibraryService.execute:verify/verifyAll',
        gui: 'Libraries verify/verifyAll',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'verifyHandler',
        },
    },
})
