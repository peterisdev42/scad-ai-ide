// Metadata-only presentation. This panel never calls an Agent Tool or reads CAD data.
if (page === 'ai') {
    const toolGroups = [
        { label: 'CAD verification', prefixes: ['cad.'] },
        { label: 'Runtime', prefixes: ['runtime.'] },
        { label: 'Customizer', prefixes: ['customizer.'] },
        { label: 'Libraries', prefixes: ['libraries.'] },
        { label: 'GitHub', prefixes: ['more.'] },
        { label: 'Development diagnostics', prefixes: ['development.'] },
        { label: 'Discovery & operations', prefixes: ['capabilities.', 'operation.'] },
    ]
    const overviewGroups = [
        { title: 'Design and customize', prefixes: ['customizer.'], description: 'Inspect parameters, manage presets and plan controlled Customizer source edits.' },
        { title: 'Verify geometry', prefixes: ['cad.'], description: 'Analyze CSG, inspect STL/3MF, measure evidence, check assemblies and review results.' },
        { title: 'Manage the toolchain', prefixes: ['runtime.', 'libraries.'], description: 'Find OpenSCAD runtimes, install libraries and restore project dependencies.' },
        { title: 'Coordinate safely', prefixes: ['capabilities.', 'operation.', 'more.', 'development.'], description: 'Discover available operations, inspect status and use permission-gated utilities.' },
    ]
    const riskLabels = { read: 'Read only', change: 'Changes state', destructive: 'Human confirmation', privileged: 'Development only' }
    const reasonLabels = {
        DEVELOPMENT_ONLY: 'Development mode required',
        UNTRUSTED_WORKSPACE: 'Workspace trust required',
        BUSY: 'Operation in progress',
        NOT_REGISTERED: 'Tools not registered',
        RUNTIME_UNAVAILABLE: 'Select an OpenSCAD runtime',
        DISABLED: 'CAD verification disabled in settings',
        DISABLED_BY_USER: 'Agent integration disabled',
        INTERACTION_UNAVAILABLE: 'Human spatial interaction required',
        STALE_SNAPSHOT: 'Verify current inputs before requesting feedback',
        DISPOSED: 'Extension session ended',
    }
    const preferenceInputs = {
        agentEnabled: get('ai-agent-enabled'),
        guidanceEnabled: get('ai-guidance-enabled'),
        sourceDiagnostics: get('ai-source-diagnostics'),
        diagnosticsOnSave: get('ai-diagnostics-on-save'),
    }

    function table(labels, name) {
        const wrapper = element('div', undefined, 'ai-table-scroll')
        wrapper.tabIndex = 0
        wrapper.setAttribute('role', 'region')
        wrapper.setAttribute('aria-label', name)
        const grid = element('table', undefined, 'ai-table')
        grid.setAttribute('aria-label', name)
        const header = element('thead')
        const row = element('tr')
        for (const label of labels) {
            const cell = element('th', label)
            cell.scope = 'col'
            row.append(cell)
        }
        header.append(row)
        const body = element('tbody')
        grid.append(header, body)
        wrapper.append(grid)
        return { wrapper, body }
    }

    function renderPreferences(preferences) {
        const effective = {
            agentEnabled: true,
            guidanceEnabled: true,
            sourceDiagnostics: true,
            diagnosticsOnSave: false,
            ...preferences,
        }
        for (const [key, input] of Object.entries(preferenceInputs)) {
            input.checked = effective[key] === true
            input.disabled = key === 'guidanceEnabled' && !effective.agentEnabled
        }
        const status = get('ai-integration-status')
        status.textContent = effective.agentEnabled ? 'Enabled' : 'Disabled by you'
        status.className = effective.agentEnabled ? 'badge success' : 'badge'
    }

    function renderOverview(state) {
        const grid = document.createDocumentFragment()
        const capabilities = state.capabilities ?? []
        for (const group of overviewGroups) {
            const count = capabilities.filter(entry => group.prefixes.some(prefix => entry.id.startsWith(prefix))).length
            if (!count) continue
            const card = element('article', undefined, 'ai-overview-card')
            card.append(element('strong', group.title), element('p', group.description))
            card.append(element('span', `${count} Agent Tools`, 'muted small'))
            grid.append(card)
        }
        get('ai-overview-groups').replaceChildren(grid)
    }

    function renderTools(state) {
        const sections = document.createDocumentFragment()
        const assigned = new Set()
        const categories = [...toolGroups, { label: 'Other capabilities', prefixes: [] }]
        for (const group of categories) {
            const capabilities = state.capabilities.filter(entry => group.prefixes.length
                ? group.prefixes.some(prefix => entry.id.startsWith(prefix))
                : !assigned.has(entry.id))
            if (!capabilities.length) continue
            const section = element('section', undefined, 'ai-capability-group')
            section.append(element('h3', `${group.label} (${capabilities.length})`))
            const { wrapper, body } = table(['Capability', 'What it does', 'Agent tool', 'Permission', 'Availability'], `${group.label} capabilities`)
            for (const capability of capabilities) {
                assigned.add(capability.id)
                const row = element('tr')
                row.dataset.capabilityId = capability.id
                const title = element('th', capability.title)
                title.scope = 'row'
                const description = element('td', capability.description)
                const tool = element('td')
                tool.append(element('code', capability.toolName))
                const policy = element('td', riskLabels[capability.risk] ?? capability.risk)
                const availability = element('td')
                availability.append(element('span', capability.availability.enabled ? 'Available' : 'Restricted',
                    capability.availability.enabled ? 'badge success' : 'badge'))
                if (capability.availability.detail) availability.append(element('p', capability.availability.detail, 'small muted'))
                if (!capability.availability.enabled) {
                    availability.append(element('p', reasonLabels[capability.availability.reasonCode] ?? capability.availability.reasonCode ?? 'Unavailable', 'small muted'))
                }
                row.append(title, description, tool, policy, availability)
                body.append(row)
            }
            section.append(wrapper)
            sections.append(section)
        }
        get('ai-capability-groups').replaceChildren(sections)
    }

    function renderResources(state) {
        const { wrapper, body } = table(['Type', 'Name', 'When to use it'], 'Agent instructions and skills')
        for (const resource of state.resources ?? []) {
            const row = element('tr')
            const name = element('th', resource.name)
            name.scope = 'row'
            row.append(element('td', resource.kind), name, element('td', resource.description))
            body.append(row)
        }
        get('ai-resources').replaceChildren(wrapper)
    }

    function render(state) {
        get('ai-loading').hidden = true
        const resources = state.resources ?? []
        get('ai-capability-count').textContent = String(state.total)
        get('ai-tool-detail-count').textContent = String(state.total)
        get('ai-skill-count').textContent = String(resources.filter(resource => resource.kind === 'Skill').length)
        get('ai-instruction-count').textContent = String(resources.filter(resource => resource.kind === 'Instruction').length)
        get('ai-resource-count').textContent = String(resources.length)
        renderPreferences(state.preferences)
        renderOverview(state)
        renderTools(state)
        renderResources(state)
    }

    for (const [key, input] of Object.entries(preferenceInputs)) {
        input.addEventListener('change', () => {
            input.disabled = true
            vscode.postMessage({ action: 'setAiPreference', key, value: input.checked })
        })
    }
    globalThis.ScadAiPanel = { render }
    if (aiState) render(aiState)
}
