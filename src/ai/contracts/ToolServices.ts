import type { CadWorkspaceService } from '../../features/cad-verification/CadWorkspaceService'
import type { createRuntimeService } from '../../features/runtime/RuntimeService'
import type { LibraryService } from '../../features/libraries/LibraryService'
import type { CustomizerDomainService } from '../../features/sidebar/CustomizerDomainService'
import type { CustomizerSourceDomainService } from '../../features/sidebar/CustomizerSourceDomainService'
import type { DeveloperCacheController } from '../../features/development/DeveloperCacheController'
import type { registerGitHub } from '../../features/github/registerGitHub'
import type { CapabilityContext } from '../../core/capabilities/CapabilityTypes'
import type { OperationTracker } from '../../core/capabilities/OperationTracker'
import type { FeaturePolicyEngine } from '../runtime/FeaturePolicyEngine'
import type { createPreviewLinks } from '../../features/preview/PreviewLinks'

export interface ToolServices {
    cad?: CadWorkspaceService
    previewLinks: ReturnType<typeof createPreviewLinks>
    runtime: ReturnType<typeof createRuntimeService>
    libraries: LibraryService
    customizerSource: CustomizerSourceDomainService
    customizer: CustomizerDomainService
    github: ReturnType<typeof registerGitHub>
    development: DeveloperCacheController
}

export interface ToolDependencies extends ToolServices {
    policy: FeaturePolicyEngine
    operations: OperationTracker
    runtimeRevision(): number
    libraryRevision(): number
}

export type ToolHandler = (input: Record<string, unknown>, context: CapabilityContext, services: ToolDependencies) => unknown
