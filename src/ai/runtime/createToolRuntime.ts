import { CapabilityDispatcher } from '../../core/capabilities/CapabilityDispatcher'
import { OperationTracker } from '../../core/capabilities/OperationTracker'
import type { ToolDependencies, ToolServices } from '../contracts/ToolServices'
import type { FeaturePreferencesSnapshot } from '../contracts/FeatureState'
import { toolBindings } from '../generated/feature-bindings.generated'
import type { CapabilityId } from '../generated/feature-ids.generated'
import { FeaturePolicyEngine } from './FeaturePolicyEngine'
import type { FeatureRegistry } from './FeatureRegistry'
import { workspaceFeatureEnvironment } from './WorkspaceFeatureEnvironment'

export function createToolRuntime(registry: FeatureRegistry, services: ToolServices, read: () => FeaturePreferencesSnapshot, trusted: () => boolean) {
    const policy = new FeaturePolicyEngine(registry, read, workspaceFeatureEnvironment(services, trusted))
    const operations = new OperationTracker()
    let runtimeRevision = 0
    let libraryRevision = 0
    const subscriptions = [services.runtime.onDidChange(() => runtimeRevision++), services.libraries.onDidChange(() => libraryRevision++)]
    const deps: ToolDependencies = { ...services, policy, operations, runtimeRevision: () => runtimeRevision, libraryRevision: () => libraryRevision }
    const dispatcher = new CapabilityDispatcher(registry, policy, (id, input, context) => toolBindings[id as CapabilityId](input, context, deps), operations)
    return {
        policy,
        dispatcher,
        dispose() {
            subscriptions.forEach((subscription) => subscription.dispose())
            dispatcher.dispose()
        },
    }
}
