// All content is metadata from the shared capability catalog; no tool is executed here.
if (page === 'ai') {
    const groups = [
        { label: 'CAD diagnostics', prefixes: ['cad.'] },
        { label: 'Runtime', prefixes: ['runtime.'] },
        { label: 'Customizer', prefixes: ['customizer.'] },
        { label: 'Libraries', prefixes: ['libraries.'] },
        { label: 'GitHub', prefixes: ['more.'] },
        { label: 'Development diagnostics', prefixes: ['development.'] },
        { label: 'Discovery & operations', prefixes: ['capabilities.', 'operation.'] },
    ]
    const riskLabels = { read: 'Read only', change: 'Changes state', destructive: 'Human confirmation', privileged: 'Development only' }
    const reasonLabels = {
        DEVELOPMENT_ONLY: 'Development mode required',
        UNTRUSTED_WORKSPACE: 'Workspace trust required',
        BUSY: 'Operation in progress',
        NOT_REGISTERED: 'Tools not registered',
        RUNTIME_UNAVAILABLE: 'Select an OpenSCAD runtime',
        DISABLED: 'CAD verification disabled in settings',
        DISPOSED: 'Extension session ended',
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
    function render(state) {
        get('ai-loading').hidden = true
        setText(get('ai-capability-count'), String(state.total))
        const sections = document.createDocumentFragment()
        const assigned = new Set()
        // Keep future catalog modules visible until their own category is defined.
        const categories = [...groups, { label: 'Other capabilities', prefixes: [] }]
        for (const group of categories) {
            const capabilities = state.capabilities.filter((entry) => group.prefixes.length ? group.prefixes.some((prefix) => entry.id.startsWith(prefix)) : !assigned.has(entry.id))
            if (!capabilities.length) continue
            const section = element('section', undefined, 'ai-capability-group')
            const heading = element('h2', `${group.label} (${capabilities.length})`)
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
                availability.append(element('span', capability.availability.enabled ? 'Available' : 'Restricted', capability.availability.enabled ? 'badge success' : 'badge'))
                if (!capability.availability.enabled) availability.append(element('p', reasonLabels[capability.availability.reasonCode] ?? capability.availability.reasonCode ?? 'Unavailable', 'small muted'))
                row.append(title, description, tool, policy, availability)
                body.append(row)
            }
            section.append(heading, wrapper)
            sections.append(section)
        }
        get('ai-capability-groups').replaceChildren(sections)
        const { wrapper, body } = table(['Type', 'Name', 'When to use it'], 'Agent instructions and skills')
        for (const resource of state.resources) {
            const row = element('tr')
            const name = element('th', resource.name)
            name.scope = 'row'
            row.append(element('td', resource.kind), name, element('td', resource.description))
            body.append(row)
        }
        get('ai-resources').replaceChildren(wrapper)
    }
    globalThis.ScadAiPanel = { render }
    if (aiState) render(aiState)
}
