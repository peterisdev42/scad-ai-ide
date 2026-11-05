/* Host validates every action and owns all filesystem changes. */
if (page === 'libraries') {
    get('placeholder').hidden = true
    const sections = ['registry', 'global', 'project']
    let tab = sections.includes(vscode.getState()?.libraryTab) ? vscode.getState().libraryTab : 'registry'
    let state
    const selections = new Map()
    const panels = new Map()
    const counts = new Map()
    const host = element('section', undefined, 'library-manager')
    host.setAttribute('aria-label', 'Library Manager')
    document.querySelector('header').after(host)

    function icon(name) {
        const paths = {
            project: ['M3 7h7l2 2h9v11H3z', 'M3 7V4h7l2 3'],
            storage: ['M4 3h16v6H4z', 'M4 15h16v6H4z', 'M7 6h.01M7 18h.01', 'M12 9v6'],
            registry: ['M4 5h5v15H4z', 'M10 3h5v17h-5z', 'm16 5 4-1 3 15-4 1z'],
            package: ['m12 3 9 5v9l-9 5-9-5V8z', 'm3 8 9 5 9-5', 'M12 13v9', 'm8 5 9 5'],
            refresh: ['M20 11a8 8 0 0 0-14-5L3 9', 'M3 3v6h6', 'M4 13a8 8 0 0 0 14 5l3-3', 'M15 15h6v6'],
            search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'],
        }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '1.5')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')
        svg.setAttribute('aria-hidden', 'true')
        svg.classList.add('library-icon')
        for (const d of paths[name] ?? paths.package) {
            const path = document.createElementNS(svg.namespaceURI, 'path')
            path.setAttribute('d', d)
            svg.append(path)
        }
        return svg
    }
    function send(action, values = {}) {
        vscode.postMessage({ action: `libraries.${action}`, ...values })
    }
    function button(label, action, values = {}, disabled = false, primary = false) {
        const b = element('button', label, primary ? 'library-primary' : 'secondary')
        b.type = 'button'
        b.disabled = disabled || !!state?.busy
        b.addEventListener('click', () => send(action, values))
        return b
    }
    function navigate(name, focus = false) {
        const changed = tab !== name
        tab = name
        vscode.setState({ ...vscode.getState(), libraryTab: tab })
        showTab()
        if (changed) send('selectTab', { tab: name })
        if (focus) get(`library-tab-${name}`).focus()
    }
    const tabs = element('div', undefined, 'tabs')
    tabs.id = 'library-tabs'
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', 'Library sections')
    tabs.setAttribute('aria-orientation', 'horizontal')
    document.querySelector('header h1').after(tabs)
    get('summary').hidden = true
    const content = element('div', undefined, 'library-content')
    const controls = element('div', undefined, 'library-header-actions')
    const refresh = button('Refresh', 'refresh')
    refresh.className = 'text-button'
    refresh.prepend(icon('refresh'))
    const cancel = button('Cancel Operation', 'cancel')
    cancel.hidden = true
    controls.append(cancel)
    const projectPath = element('p', '', 'path library-current-project')
    projectPath.setAttribute('aria-label', 'Current project path')
    const status = element('p', '', 'notice library-status')
    status.hidden = true
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    const error = element('p', '', 'notice error request-error')
    error.hidden = true
    error.setAttribute('role', 'alert')
    content.append(controls, status, error)
    host.append(content)
    for (const name of sections) {
        const b = element('button')
        b.setAttribute('role', 'tab')
        b.id = `library-tab-${name}`
        b.setAttribute('aria-controls', `library-panel-${name}`)
        b.setAttribute('aria-label', name[0].toUpperCase() + name.slice(1))
        const count = element('span', '0', 'count')
        count.setAttribute('aria-hidden', 'true')
        counts.set(name, count)
        b.append(document.createTextNode(name[0].toUpperCase() + name.slice(1) + ' '), count)
        const panel = element('section', undefined, 'library-section')
        panel.id = `library-panel-${name}`
        panel.setAttribute('role', 'tabpanel')
        panel.tabIndex = 0
        panel.setAttribute('aria-labelledby', b.id)
        b.addEventListener('click', () => navigate(name))
        tabs.append(b)
        content.append(panel)
        panels.set(name, panel)
    }
    tabs.addEventListener('keydown', (event) => {
        const names = sections
        const i = names.indexOf(tab)
        const forward = 'ArrowRight'
        const backward = 'ArrowLeft'
        const next = event.key === forward ? (i + 1) % 3 : event.key === backward ? (i + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : undefined
        if (next !== undefined) {
            event.preventDefault()
            navigate(names[next], true)
        }
    })
    function showTab() {
        refresh.hidden = tab !== 'registry'
        controls.hidden = cancel.hidden
        for (const [name, panel] of panels) {
            panel.hidden = tab !== name
            const b = get(`library-tab-${name}`)
            b.setAttribute('aria-selected', String(tab === name))
            b.tabIndex = tab === name ? 0 : -1
        }
    }
    function badge(text, tone = '') {
        return element('span', text, `library-badge ${tone}`)
    }
    function card(name, description, glyph = 'package') {
        const row = element('article', undefined, 'library-card')
        const mark = element('div', undefined, 'library-package-mark')
        mark.append(icon(glyph))
        const info = element('div', undefined, 'library-card-info')
        const heading = element('div', undefined, 'library-card-heading')
        heading.append(element('h3', name))
        const header = element('div', undefined, 'library-card-header')
        header.append(heading)
        info.append(header)
        if (description) info.append(element('p', description, 'library-description'))
        const actions = element('div', undefined, 'library-card-actions')
        row.append(mark, info, actions)
        return { row, info, heading, header, actions }
    }
    function sameRepository(left, right) {
        const normalize = (url) => (url ?? '').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase()
        return normalize(left) === normalize(right)
    }
    function libraryCard(library, fallback = {}, cached = false) {
        const view = card(library?.name ?? fallback.name ?? fallback.id, library?.description)
        if (library?.license) view.heading.append(badge(library.license))
        if (cached || library?.versions.some((version) => version.cached)) view.heading.append(badge('Cached', 'library-badge-success'))
        const links = element('div', undefined, 'library-links')
        for (const [label, href] of [['Repository', fallback.repositoryUrl ?? library?.repositoryUrl], ['Documentation', library?.documentationUrl]]) {
            if (!href) continue
            try {
                if (!['http:', 'https:'].includes(new URL(href).protocol)) continue
            } catch { continue }
            const link = element('a', label)
            link.href = href
            links.append(link)
        }
        if (links.childElementCount) view.header.append(links)
        return view
    }
    function empty(panel, title, description, browse = false) {
        const box = element('div', undefined, 'library-empty')
        box.append(icon('package'), element('h3', title), element('p', description))
        if (browse) {
            const b = element('button', 'Browse Registry')
            b.addEventListener('click', () => navigate('registry'))
            box.append(b)
        }
        panel.append(box)
    }
    function defaultVersion(library) {
        // Use the Registry recommendation, then its already ordered exact versions.
        return library.versions.find((version) => version.label === library.latestVersion)?.label ?? library.versions[0]?.label ?? ''
    }
    function dropdown(picker) {
        const control = element('span', undefined, 'library-select')
        control.append(picker)
        return control
    }
    function versionPicker(library, context, initial = defaultVersion(library)) {
        const picker = element('select')
        const key = `${state.selectedProject ?? ''}:${context}:${library.id}`
        picker.dataset.focusKey = key
        picker.setAttribute('aria-label', `${library.name} version`)
        if (!library.versions.length) {
            const placeholder = element('option', 'No versions available')
            placeholder.value = ''
            picker.append(placeholder)
        }
        for (const version of library.versions) {
            const option = element('option', `${version.label} · ${version.commit.slice(0, 12)}${version.prerelease ? ' · prerelease' : ''}${version.cached ? ' · cached' : ''}${version.layoutError ? ' · layout unverified' : ''}`)
            option.value = version.label
            picker.append(option)
        }
        const selected = selections.get(key) ?? initial
        picker.value = library.versions.some((v) => v.label === selected) ? selected : defaultVersion(library)
        picker.disabled = state.busy || !library.versions.length
        picker.addEventListener('change', () => selections.set(key, picker.value))
        return picker
    }
    function installButton(library, picker, label) {
        const b = element('button', label, 'library-primary')
        const update = () => {
            const version = library.versions.find((v) => v.label === picker.value)
            b.disabled = state.busy || !state.trusted || !state.selectedProject || !version || !!version.layoutError || library.sync.status === 'error' || !!library.validationError
            b.title = version?.layoutError || library.validationError || 'Installs the selected exact commit'
        }
        b.addEventListener('click', () => send('install', { id: library.id, version: picker.value }))
        picker.addEventListener('change', update)
        update()
        return b
    }
    // Keep the search field mounted while host progress updates replace result cards.
    const registry = panels.get('registry')
    const form = element('div', undefined, 'library-search')
    const search = element('input')
    search.type = 'search'
    search.placeholder = 'Search libraries by name, ID, or description'
    search.maxLength = 500
    search.setAttribute('aria-label', 'Search registry')
    const searchField = element('div', undefined, 'library-search-input')
    searchField.append(icon('search'), search)
    form.append(searchField, refresh)
    let searchTimer
    let filterQuery = ''
    search.addEventListener('input', () => {
        queryInitialized = true
        clearTimeout(searchTimer)
        searchTimer = setTimeout(() => {
            filterQuery = search.value.trim()
            if (state) render(state)
        }, 300)
    })
    window.addEventListener('pagehide', () => clearTimeout(searchTimer))
    const registryResults = element('div')
    registry.append(form, registryResults)
    let queryInitialized = false

    const globalActions = element('div', undefined, 'library-global-actions')
    const verifyAll = button('Verify All', 'verifyAll')
    verifyAll.title = 'Check cached file hashes for missing or corrupted content. Does not download updates or repair libraries.'
    const cleanupSplit = element('div', undefined, 'library-cleanup-split')
    const cleanupAll = button('Delete All Global Dependencies', 'cleanupAll', { mode: 'all' })
    const cleanupToggle = element('button', undefined, 'secondary library-cleanup-toggle')
    cleanupToggle.type = 'button'
    cleanupToggle.setAttribute('aria-label', 'Cache cleanup options')
    cleanupToggle.setAttribute('aria-haspopup', 'menu')
    cleanupToggle.setAttribute('aria-expanded', 'false')
    cleanupToggle.setAttribute('aria-controls', 'library-cleanup-menu')
    const cleanupMenu = element('div', undefined, 'library-cleanup-menu')
    cleanupMenu.id = 'library-cleanup-menu'
    cleanupMenu.setAttribute('role', 'menu')
    cleanupMenu.setAttribute('aria-label', 'Cache cleanup options')
    cleanupMenu.hidden = true
    function closeCleanupMenu(focus = false) {
        cleanupMenu.hidden = true
        cleanupToggle.setAttribute('aria-expanded', 'false')
        if (focus) cleanupToggle.focus()
    }
    for (const [label, mode] of [['Delete all global dependencies', 'all'], ['Delete unreferenced global dependencies', 'unused']]) {
        const item = element('button', label)
        item.type = 'button'
        item.setAttribute('role', 'menuitem')
        item.addEventListener('click', () => { closeCleanupMenu(true); send('cleanupAll', { mode }) })
        cleanupMenu.append(item)
    }
    function openCleanupMenu() {
        cleanupMenu.hidden = false
        cleanupToggle.setAttribute('aria-expanded', 'true')
        cleanupMenu.querySelector('button').focus()
    }
    cleanupToggle.addEventListener('click', () => { if (cleanupMenu.hidden) openCleanupMenu(); else closeCleanupMenu() })
    cleanupToggle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); openCleanupMenu() }
    })
    cleanupMenu.addEventListener('keydown', (event) => {
        const items = [...cleanupMenu.querySelectorAll('button')]
        const i = items.indexOf(document.activeElement)
        if (event.key === 'Escape') { event.preventDefault(); closeCleanupMenu(true) }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next].focus()
        }
    })
    document.addEventListener('click', (event) => { if (!cleanupSplit.contains(event.target)) closeCleanupMenu() })
    cleanupSplit.addEventListener('focusout', (event) => { if (!cleanupSplit.contains(event.relatedTarget)) closeCleanupMenu() })
    cleanupSplit.append(cleanupAll, cleanupToggle, cleanupMenu)
    globalActions.append(verifyAll, cleanupSplit)

    const renderedSections = new Map()
    function needsRender(name, values) {
        const key = JSON.stringify(values)
        if (renderedSections.get(name) === key) return false
        renderedSections.set(name, key)
        return true
    }

    function render(s) {
        const focused = document.activeElement?.dataset.focusKey
        state = s
        host.setAttribute('aria-busy', String(s.busy))
        setText(projectPath, s.selectedProject ?? 'No project open')
        refresh.disabled = s.busy || s.registryBusy
        refresh.setAttribute('aria-busy', String(!!s.registryBusy))
        cancel.hidden = !s.cancellable
        cancel.disabled = !s.cancellable
        status.textContent = [s.busy ? s.message : '', !s.trusted ? 'Trust this workspace to modify dependencies.' : ''].filter(Boolean).join(' ')
        status.hidden = !status.textContent
        status.classList.toggle('library-working', !!s.busy)
        error.textContent = [s.error, s.projectError, s.registryError].filter(Boolean).join('\n')
        error.hidden = !error.textContent
        counts.get('project').textContent = s.projectDependencies.length
        counts.get('registry').textContent = s.registry.length
        if (needsRender('project', [s.projectDependencies, s.selectedProject, s.trusted, s.busy, s.registry])) {
            const project = panels.get('project')
            project.replaceChildren(element('p', 'Project dependencies are pinned to exact versions in this project. Restore rebuilds local links from the lockfile; switching or removing a library changes this project only.', 'library-section-description'), projectPath)
            const projectActions = element('div', undefined, 'library-project-actions')
            projectActions.append(button('Restore Dependencies', 'restore', {}, !s.trusted || !s.selectedProject), button('Repair Links', 'repair', {}, !s.trusted || !s.selectedProject))
            project.append(projectActions)
            if (!s.projectDependencies.length) empty(project, s.selectedProject ? 'Add your first library' : 'Open a project to get started', s.selectedProject ? 'Browse the registry, choose a version, and install it to this project.' : 'Open a workspace folder to install and restore project dependencies.', !!s.selectedProject)
            const projectList = element('div', undefined, 'library-list')
            project.append(projectList)
            for (const dep of s.projectDependencies) {
                const library = s.registry.find((library) => library.id === dep.id && (!dep.repositoryUrl || sameRepository(library.repositoryUrl, dep.repositoryUrl)))
                const { row, heading, actions } = libraryCard(library, { id: dep.id, name: dep.name, repositoryUrl: dep.repositoryUrl })
                if (dep.status !== 'Ready') heading.append(badge(dep.status, 'library-badge-warning'))
                if (library) {
                    const picker = versionPicker(library, 'project', dep.version)
                    actions.append(dropdown(picker), installButton(library, picker, 'Switch Version'))
                } else {
                    const picker = element('select')
                    picker.setAttribute('aria-label', `${dep.name ?? dep.id} version`)
                    picker.append(element('option', dep.version ?? 'Unmatched lock entry'))
                    picker.disabled = true
                    const switchVersion = button('Switch Version', 'install', {}, true, true)
                    switchVersion.title = 'Version switching requires this library in the local Registry catalog.'
                    actions.append(dropdown(picker), switchVersion)
                }
                actions.append(button('Remove', 'remove', { id: dep.id }, !s.trusted))
                projectList.append(row)
            }
        }
        if (needsRender('global', [s.global, s.globalIssues, s.registry, s.selectedProject, s.busy, s.trusted, s.bulkResult])) {
            const global = panels.get('global')
            global.replaceChildren(element('p', 'Global stores downloaded library versions shared by all projects. Installing a cached version reuses these files. Delete all removes every global version, including those used by projects; Restore Dependencies can download them again. Unreferenced cleanup checks known projects and skips versions whose references cannot be verified.', 'library-section-description'), globalActions)
            for (const control of [verifyAll, cleanupAll, cleanupToggle, ...cleanupMenu.querySelectorAll('button')]) control.disabled = s.busy || !s.trusted || !s.global.length
            if (s.busy || !s.global.length) closeCleanupMenu()
            if (s.bulkResult) global.append(element('p', s.bulkResult, 'library-bulk-result'))
            for (const issue of s.globalIssues ?? []) global.append(element('p', `${issue.path}: ${issue.message}`, 'notice warning request-error'))
            if (!s.global.length) empty(global, 'No cached libraries yet', 'Installed library versions appear here and can be reused by other projects.')
            const globalList = element('div', undefined, 'library-list')
            global.append(globalList)
            const groups = new Map()
            for (const library of s.global) {
                const identity = JSON.stringify([library.libraryId, library.repositoryUrl])
                if (!groups.has(identity)) groups.set(identity, [])
                groups.get(identity).push(library)
            }
            counts.get('global').textContent = groups.size
            for (const [identity, versions] of groups) {
                const first = versions[0]
                const registryLibrary = s.registry.find((library) => library.id === first.libraryId && sameRepository(library.repositoryUrl, first.repositoryUrl))
                const { row, heading, actions } = libraryCard(registryLibrary, { id: first.libraryId, repositoryUrl: first.repositoryUrl }, true)
                const picker = element('select')
                const selectionKey = `global:${identity}`
                picker.dataset.focusKey = selectionKey
                picker.setAttribute('aria-label', `${first.libraryId} version`)
                const recommended = registryLibrary?.versions.find((version) => version.label === defaultVersion(registryLibrary))
                const initial = versions.find((version) => version.commit === recommended?.commit) ?? versions[0]
                for (const version of versions) {
                    const option = element('option', version.versions.join(', ') || `snapshot:${version.commit.slice(0, 12)}`)
                    option.value = version.key
                    picker.append(option)
                }
                const selected = selections.get(selectionKey)
                picker.value = versions.some((version) => version.key === selected) ? selected : initial.key
                picker.disabled = s.busy
                const warning = badge('', 'library-badge-warning')
                heading.append(warning)
                const operations = [
                    ['Verify', 'verify'],
                    ['Repair', 'repairGlobal'],
                    ['Preview Cleanup…', 'previewCleanup'],
                ].map(([label, action]) => {
                    const control = element('button', label, 'secondary')
                    control.type = 'button'
                    control.addEventListener('click', () => send(action, { key: picker.value }))
                    return control
                })
                const install = element('button', 'Install to Project', 'library-primary')
                install.type = 'button'
                install.addEventListener('click', () => {
                    const cached = versions.find((version) => version.key === picker.value)
                    const exact = registryLibrary?.versions.find((version) => version.commit === cached.commit)
                    if (exact) send('install', { id: first.libraryId, version: exact.label })
                })
                const update = () => {
                    const version = versions.find((version) => version.key === picker.value)
                    const exact = registryLibrary?.versions.find((entry) => entry.commit === version.commit)
                    install.disabled = s.busy || !s.trusted || !s.selectedProject || !exact || !!exact.layoutError || !!registryLibrary?.validationError || registryLibrary?.sync.status === 'error' || version.status !== 'ready'
                    install.title = exact?.layoutError || registryLibrary?.validationError || (!exact ? 'Install requires this cached version in the local Registry catalog.' : 'Reuse the selected cached version in this project.')
                    warning.textContent = version.status === 'ready' ? '' : version.status
                    warning.hidden = !warning.textContent
                    for (const control of operations) control.disabled = s.busy || !s.trusted
                    const cleanup = operations[2]
                    cleanup.disabled ||= !!version.references.projects.length || !!version.references.unavailable.length
                    cleanup.title = version.references.projects.length ? 'In use by a known project.' : version.references.unavailable.length ? 'Some known projects are unavailable.' : 'Preview cleanup of the selected cached version.'
                }
                picker.addEventListener('change', () => {
                    selections.set(selectionKey, picker.value)
                    update()
                })
                update()
                actions.append(dropdown(picker), install, ...operations)
                globalList.append(row)
            }
        }
        if (!queryInitialized) {
            search.value = s.query ?? ''
            filterQuery = search.value.trim()
            queryInitialized = true
        }
        // A warm refresh changes only the Refresh control; keep cached cards mounted.
        if (needsRender('registry', [s.registry, s.selectedProject, s.trusted, s.busy, filterQuery, !s.registry.length && [s.registryBusy, s.registryError, s.registryLoaded]])) {
            registryResults.replaceChildren()
            const query = filterQuery.toLowerCase()
            const filtered = s.registry.filter((library) => `${library.id} ${library.name} ${library.description}`.toLowerCase().includes(query))
            if (!s.registry.length && s.registryBusy) empty(registryResults, 'Loading libraries…', 'Fetching the library registry.')
            else if ((!s.registryError || s.registry.length) && !filtered.length && (s.registry.length || s.registryLoaded !== false)) empty(registryResults, query ? 'No matching libraries' : 'No libraries to display', query ? 'Try another name, library ID, or keyword.' : 'Refresh to load the registry. Cached versions remain available offline.')
            const registryList = element('div', undefined, 'library-list')
            registryResults.append(registryList)
            for (const library of filtered) {
                const { row, info, actions } = libraryCard(library)
                if (library.validationError) info.append(element('p', library.validationError, 'notice error'))
                if (library.layoutError && !library.versions.some((v) => !v.layoutError)) info.append(element('p', library.layoutError, 'notice warning'))
                const picker = versionPicker(library, 'registry')
                actions.append(dropdown(picker), installButton(library, picker, 'Install to Project'))
                registryList.append(row)
            }
        }
        if (focused) [...host.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focused)?.focus({ preventScroll: true })
        showTab()
    }
    window.addEventListener('message', (event) => {
        if (event.data?.type === 'librariesState') render(event.data.state)
    })
    if (librariesState) render(librariesState)
    showTab()
}
