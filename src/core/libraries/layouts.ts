interface AuditedLayout {
    id: string
    repositoryUrl: string
    commit: string
    includeName?: string
    includeRoot?: string
    entryPoint?: string
    blockedReason?: string
}
// The same reviewed data is shipped in the bundle and documented in library-layout-audit.md.
export const auditedLayouts = require('../../../resources/libraries/layouts.json') as AuditedLayout[]
