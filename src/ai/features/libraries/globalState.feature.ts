import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.globalState',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Read global library cache',
        summary: 'Inspect bounded global cache metadata, integrity issues and references. Exact cache keys identify verify/repair/cleanup targets. No raw file inventories. Includes shared busy/cancellable/message/error activity for tasks started in GUI or Agent; use operation_cancel with domain=libraries to request cancellation, then read state until busy clears.',
        order: 23,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'libraries.globalState',
        name: 'scad_ai_ide_libraries_globalState',
        referenceName: 'scad_libraries_globalState',
        modelDescription: 'Inspect bounded global cache metadata, integrity issues and references. Exact cache keys identify verify/repair/cleanup targets. No raw file inventories. Includes shared busy/cancellable/message/error activity for tasks started in GUI or Agent; use operation_cancel with domain=libraries to request cancellation, then read state until busy clears.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                offset: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: [],
        },
        risk: 'read',
        service: 'LibraryService.getState',
        gui: 'Libraries global',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'globalStateHandler',
        },
    },
})
