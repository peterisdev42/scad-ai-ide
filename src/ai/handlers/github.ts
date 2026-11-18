import { safePreview } from '../../core/capabilities/SafeOutput'
import { type ToolHandler } from '../contracts/ToolServices'

export const githubStatusHandler: ToolHandler = async (_input, _context, { github }) => {
    await github.refresh()
    const { mode, busy, account, loginSuggested, message } = github.getState()
    return { mode, busy, account, loginSuggested, message: message ? safePreview(message) : undefined }
}

export const authorizeGitHubHandler: ToolHandler = async (_input, _context, { runtime, github }) => {
    await github.connect()
    await runtime.loadBuilds(true)
    const { mode, busy, account, loginSuggested, message } = github.getState()
    return { mode, busy, account, loginSuggested, message: message ? safePreview(message) : undefined }
}
