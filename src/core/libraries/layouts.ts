interface AuditedLayout {
    id: string
    repositoryUrl: string
    commit: string
    includeName?: string
    includeRoot?: string
    entryPoint?: string
    blockedReason?: string
}
// Canonical reviewed layouts are shipped in the bundle from resources/libraries/layouts.json.
export const auditedLayouts = require('../../../resources/libraries/layouts.json') as AuditedLayout[]
