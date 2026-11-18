if (page === 'ai') {
    let revision = 0
    let newest
    let repaint

    function build(catalog, layout) {
        const updates = []
        const controls = Object.entries(catalog.controls)
        const sectionContent = document.createDocumentFragment()
        const groupById = new Map(catalog.groups.map(group => [group.id, group]))
        const features = catalog.features.toSorted((a, b) => a.display.order - b.display.order || a.id.localeCompare(b.id))
        const byId = new Map(features.map(feature => [feature.id, feature]))
        const byGroup = new Map(catalog.groups.map(group => [group.id, features.filter(feature => feature.group === group.id && !feature.setting)]))

        function control(label, description, read, request, choices) {
            const row = element('label', undefined, 'ai-preference-row')
            const text = element('span', undefined, 'ai-preference-description')
            text.append(element('strong', label))
            if (description) text.append(element('small', description))
            const input = element(choices ? 'select' : 'input')
            input.setAttribute('aria-label', label)
            if (choices) {
                for (const choice of choices) {
                    const option = element('option', choice)
                    option.value = choice
                    input.append(option)
                }
            } else input.type = 'checkbox'
            let confirmed
            const apply = () => {
                if (choices) input.value = confirmed
                else input.checked = confirmed === true
            }
            updates.push(state => {
                confirmed = read(state)
                apply()
            })
            input.addEventListener('change', () => {
                const next = choices ? input.value : input.checked
                get('action-error').hidden = true
                apply()
                vscode.postMessage(request(next))
            })
            row.append(text, input)
            return row
        }

        function rowFor(feature) {
            const { id, display, tool, setting, resource } = feature
            const row = element('li', undefined, 'ai-feature-row')
            row.dataset.featureId = id
            const title = element('div', undefined, 'ai-feature-title')
            if (feature.configurable) {
                title.append(control(display.label, display.summary,
                    state => setting ? state.preferences.editorAssistance[id] : state.state[id].userPreferenceEnabled,
                    value => setting ? { action: 'ai.setSettingEnabled', featureId: id, value } : { action: 'ai.setFeatureEnabled', featureId: id, enabled: value },
                    setting?.enum))
            } else {
                title.append(element('strong', display.label), element('p', display.summary))
            }
            row.append(title)
            const status = element('span', undefined, 'badge')
            const detail = element('p', undefined, 'muted small')
            row.append(status, detail)
            if (tool || resource) {
                const metadata = element('details', undefined, 'ai-feature-metadata')
                metadata.append(element('summary', 'Details'))
                metadata.append(element('code', tool?.name ?? resource.path))
                if (tool) metadata.append(element('p', layout.risks[tool.risk] ?? tool.risk, 'muted small'))
                const related = feature.dependencies?.recommends ?? []
                if (related.length) metadata.append(element('p', 'Related features: ' + related.map(id => byId.get(id)?.display.label ?? id).join(', '), 'muted small'))
                const required = feature.dependencies?.allOf ?? []
                if (required.length) metadata.append(element('p', 'Required features: ' + required.map(id => byId.get(id)?.display.label ?? id).join(', '), 'muted small'))
                row.append(metadata)
            }
            updates.push(({ state }) => {
                const current = state[id]
                status.textContent = layout.reasons[current.reasonCode] ?? current.reasonCode
                status.classList.toggle('success', current.effectiveEnabled)
                detail.textContent = current.reasonDetail
                detail.hidden = !current.reasonDetail
            })
            return row
        }

        function list(entries) {
            const rows = element('ul', undefined, 'ai-feature-list')
            rows.append(...entries.map(rowFor))
            return rows
        }

        const renderers = {
            controls(section) {
                for (const [id, metadata] of controls) {
                    section.append(control(metadata.label, metadata.description,
                        state => state.preferences[id], enabled => ({ action: 'ai.setIntegrationEnabled', controlId: id, enabled })))
                }
            },
            overview(section) {
                const counts = element('ul', undefined, 'ai-overview-grid ai-feature-list')
                for (const [kind, { label }] of Object.entries(layout.kinds)) {
                    const count = features.filter(feature => feature.kind === kind).length
                    if (count) counts.append(element('li', `${label} · ${count}`, 'ai-overview-card'))
                }
                section.append(counts)
            },
            groups(section) {
                for (const [id, entries] of byGroup) {
                    const group = groupById.get(id)
                    if (!group.control) continue
                    const available = element('p', undefined, 'muted small')
                    updates.push(state => {
                        const selected = entries.filter(feature => state.state[feature.id].userPreferenceEnabled).length
                        const enabled = entries.filter(feature => state.state[feature.id].effectiveEnabled).length
                        available.textContent = `${selected}/${entries.length} selected · ${enabled} available`
                    })
                    const details = element('details', undefined, 'ai-disclosure')
                    details.append(element('summary', group.label))
                    details.append(control('Enable ' + group.label, group.control.description,
                        state => state.preferences.groups[id], enabled => ({ action: 'ai.setGroupEnabled', groupId: id, enabled })))
                    details.append(available)
                    const tools = entries.filter(feature => feature.tool)
                    if (tools.length) details.append(list(tools))
                    section.append(details)
                }
            },
            resources(section) {
                for (const [kind, { label }] of Object.entries(layout.kinds)) {
                    const entries = features.filter(feature => feature.resource && feature.kind === kind)
                    if (!entries.length) continue
                    const details = element('details', undefined, 'ai-disclosure')
                    details.append(element('summary', `${label} (${entries.length})`), list(entries))
                    section.append(details)
                }
            },
            settings(section) { section.append(list(features.filter(feature => feature.setting))) },
        }

        for (const descriptor of layout.sections) {
            const section = element('section', undefined, 'ai-section')
            const heading = element('h2', descriptor.label)
            heading.id = 'ai-heading-' + descriptor.source
            section.setAttribute('aria-labelledby', heading.id)
            section.append(heading)
            if (descriptor.description) section.append(element('p', descriptor.description, 'muted small'))
            renderers[descriptor.source](section)
            sectionContent.append(section)
        }
        get('ai-content').replaceChildren(sectionContent)
        get('ai-loading').hidden = true
        return state => updates.forEach(update => update(state))
    }

    window.addEventListener('message', ({ data }) => {
        if (data?.type !== 'ai.snapshot' || data.state.schemaVersion !== 1) return
        if (!repaint && data.catalog && data.layout?.schemaVersion === 1) repaint = build(data.catalog, data.layout)
        if (!newest || data.state.revision > newest.revision) newest = data.state
        if (!repaint || newest.revision <= revision) return
        revision = newest.revision
        repaint(newest)
    })
    vscode.postMessage({ action: 'ready' })
}
