export const namespace = 'scad-ai-ide'
export const configurationId = 'scad-ai-ide.features'
export const controls = {
    agentEnabled: {
        key: namespace + '.agent.enabled',
        label: 'Enable AI Agent integration',
        default: true,
        scope: 'application',
        description: 'Expose SCAD AI IDE tools, instructions and skills to compatible VS Code AI agents. Disabling this does not disable regular IDE features or other extensions.',
    },
    guidanceEnabled: {
        key: namespace + '.agent.guidanceEnabled',
        label: 'Provide Agent guidance',
        default: true,
        scope: 'application',
        description: 'Contribute OpenSCAD Agent Skills and Instructions when SCAD AI IDE Agent integration is enabled. Tool availability is controlled separately by agent.enabled.',
    },
}
export const groups = {
    cad: 'CAD verification',
    runtime: 'Runtime',
    customizer: 'Customizer',
    libraries: 'Libraries',
    github: 'GitHub',
    development: 'Development diagnostics',
    discovery: 'Discovery and operations',
    editor: 'Independent editor assistance',
}

export const adapters = {
    tool: { contribution: 'languageModelTools' },
    skill: { contribution: 'chatSkills', glob: 'skills/**/SKILL.md', guidance: true },
    instruction: { contribution: 'chatInstructions', glob: 'instructions/*.instructions.md', guidance: true },
    prompt: { contribution: 'chatPromptFiles', glob: 'prompts/*.prompt.md' },
    chatAgent: { contribution: 'chatAgents', glob: 'agents/*.agent.md' },
    setting: {},
}

export const reasonLabels = {
    AVAILABLE: 'Available',
    DISABLED_GLOBAL: 'Agent integration is disabled',
    DISABLED_GUIDANCE: 'Agent guidance is disabled',
    DISABLED_GROUP: 'Group is disabled',
    DISABLED_FEATURE: 'Feature is disabled',
    DISABLED_DEPENDENCY: 'A required feature is disabled or unavailable',
    UNTRUSTED_WORKSPACE: 'Workspace trust required',
    DEVELOPMENT_ONLY: 'Development mode required',
    BUSY: 'Operation in progress',
    NOT_REGISTERED: 'Service unavailable',
    RUNTIME_UNAVAILABLE: 'Select an OpenSCAD runtime',
    DISABLED: 'CAD verification disabled in settings',
    INTERACTION_UNAVAILABLE: 'Human spatial interaction required',
    STALE_SNAPSHOT: 'Verify current inputs before requesting feedback',
    UNAVAILABLE: 'Unavailable',
    DISPOSED: 'Extension session ended',
}
export const risks = { read: 'Read only', change: 'Changes state', destructive: 'Destructive operation', privileged: 'Privileged operation' }
