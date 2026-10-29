import { notifications } from '../../../../platform/notifications'

/** Reports through the shared catalog so setup failures aggregate across features. */
export function showRenderError(error: Error, showOutput: () => void, scope?: string): Promise<void> {
    return notifications.renderFailed(error, showOutput, scope)
}
