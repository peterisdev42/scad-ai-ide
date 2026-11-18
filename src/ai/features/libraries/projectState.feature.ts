import { defineTool } from '../../contracts/Feature'

export default defineTool({
    id: 'tool.libraries.projectState',
    kind: 'tool',
    group: 'libraries',
    display: {
        label: 'Read project dependencies',
        summary: 'List workspace projects, or dependencies for one exact project path returned by this tool. Reports manifest/lock and mount state; no writes. Includes shared busy/cancellable/message/error activity for tasks started in GUI or Agent; use operation_cancel with domain=libraries to request cancellation, then read state until busy clears.',
        order: 22,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    tool: {
        capabilityId: 'libraries.projectState',
        name: 'scad_ai_ide_libraries_projectState',
        referenceName: 'scad_libraries_projectState',
        modelDescription: 'List workspace projects, or dependencies for one exact project path returned by this tool. Reports manifest/lock and mount state; no writes. Includes shared busy/cancellable/message/error activity for tasks started in GUI or Agent; use operation_cancel with domain=libraries to request cancellation, then read state until busy clears.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                project: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4096,
                },
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
        service: 'LibraryService.projectState',
        gui: 'Libraries project selector/dependencies',
        binding: {
            module: 'src/ai/handlers/libraries.ts',
            export: 'projectStateHandler',
        },
    },
})
