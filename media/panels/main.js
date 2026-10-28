const vscode = acquireVsCodeApi()
const page = document.body.dataset.page
const get = (id) => document.getElementById(id)
let runtimeState
let pendingLocalAction
const actionErrors = { overview: '', installed: '', available: '' }
const actionSeverities = { overview: 'error', installed: 'error', available: 'error' }
const actionOrigins = new Map()
const summaries = {
    ai: 'Manage Skills, MCP, Agent Tools and AI Providers.',
    bricks: 'Manage reusable OpenSCAD bricks.',
    libraries: 'Manage OpenSCAD libraries and project dependencies.',
    more: 'Configure integrations for SCAD AI IDE.',
}
const runtimeTabs = ['overview', 'installed', 'available']
get('summary').textContent = summaries[page] ?? ''
get('summary').hidden = !summaries[page]
get(page === 'runtime' ? 'runtime' : page === 'more' ? 'more' : 'placeholder').hidden = false
get('runtime-tabs').hidden = page !== 'runtime'
get('more-tabs').hidden = page !== 'more'
const headings = { ai: 'AI configuration', bricks: 'Bricks', libraries: 'Libraries' }
get('placeholder-heading').textContent = headings[page] ?? ''

function selectTab(id, focus = false) {
    if (!runtimeTabs.includes(id)) {
        return
    }
    for (const tab of get('runtime-tabs').querySelectorAll('[role="tab"]')) {
        const selected = tab.dataset.tab === id
        tab.setAttribute('aria-selected', String(selected))
        tab.tabIndex = selected ? 0 : -1
        get(tab.getAttribute('aria-controls')).hidden = !selected
        if (selected && focus) {
            tab.focus()
        }
    }
    vscode.setState({ ...vscode.getState(), runtimeTab: id })
    updateNoticeVisibility()
    if (id === 'installed') {
        vscode.postMessage({ action: 'refreshInstalled' })
    }
}
if (page === 'runtime') {
    for (const host of document.querySelectorAll('[data-local-runtime-options]')) {
        host.append(get('local-runtime-options-template').content.cloneNode(true))
    }
    const saved = vscode.getState()?.runtimeTab
    selectTab(runtimeTabs.includes(saved) ? saved : 'overview')
}

function element(tag, text, className) {
    const node = document.createElement(tag)
    if (text !== undefined) {
        node.textContent = text
    }
    if (className) {
        node.className = className
    }
    return node
}

const sourceNames = {
    custom: 'Custom location',
    PATH: 'Found on PATH',
    official: 'OpenSCAD installation',
    bundled: 'Managed runtime',
    managed: 'Installed by SCAD AI IDE',
    'native-package': 'System installation',
    homebrew: 'Homebrew',
    macports: 'MacPorts',
    flatpak: 'Flatpak',
    snap: 'Snap',
    scoop: 'Scoop',
}

function versionMetadata(fields) {
    const values = element('dl', undefined, 'version-metadata')
    for (const [label, value] of fields) {
        if (value) {
            const field = element('div')
            const name = element('dt', label)
            field.append(name, element('dd', value, 'path'))
            values.append(field)
        }
    }
    return values
}

function replaceVersions(container, rows) {
    const focusKey = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined
    container.replaceChildren(...rows)
    if (focusKey) {
        const target = [...container.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey)
        target?.focus({ preventScroll: true })
    }
}

function updateNoticeVisibility() {
    const current = vscode.getState()?.runtimeTab ?? 'overview'
    for (const tab of runtimeTabs) {
        const notice = get(`${tab}-error`)
        notice.hidden = page !== 'runtime' || tab !== current || !notice.textContent
    }
}

function renderErrors(state) {
    const discoveryError = state.message && state.message !== 'No OpenSCAD runtime found' ? state.message : ''
    const releaseError = state.buildsError ? `${state.buildsError}\n\n${state.builds.length ? 'Previously loaded versions are shown below.' : 'Use Refresh to retry, or install a downloaded archive below.'}` : ''
    for (const [tab, error] of [
        ['overview', discoveryError],
        ['installed', discoveryError],
        ['available', releaseError],
    ]) {
        const text = [...new Set([error, state.installationError, actionErrors[tab]].filter(Boolean))].join('\n\n')
        get(`${tab}-error`).textContent = text
        const isError = (error && (tab === 'available' || state.messageSeverity !== 'warning')) || state.installationError || (actionErrors[tab] && actionSeverities[tab] !== 'warning')
        get(`${tab}-error`).className = `notice ${isError ? 'error' : 'warning'} request-error`
    }
    updateNoticeVisibility()
}

function renderLocalActions(state, loading) {
    const labels = { refresh: 'Rescan', browse: 'Add Existing Runtime', installArchive: 'Install from Archive…' }
    for (const button of document.querySelectorAll('[data-runtime-action]')) {
        const action = button.dataset.action
        const pending = (action === 'refresh' && state.busy) || pendingLocalAction === action || (action === 'installArchive' && state.installing && state.installationIsArchive)
        button.disabled = (action === 'refresh' && state.busy) || loading || !!state.installing || !!state.selectingId || !!state.deletingId || !!pendingLocalAction
        button.textContent = pending ? (action === 'refresh' ? 'Scanning…' : action === 'browse' ? 'Adding…' : 'Installing…') : labels[action]
        button.setAttribute('aria-busy', String(!!pending))
    }
    for (const status of document.querySelectorAll('[data-local-runtime-status]')) {
        const text = state.installationIsArchive && !state.installationError ? (state.installing ? `${state.installing.message}${state.installing.percent === undefined ? '' : ` ${state.installing.percent}%`}` : state.installationMessage) : ''
        status.textContent = text ?? ''
        status.hidden = !text
    }
}

function render(state) {
    runtimeState = state
    const loading = state.busy && !state.refreshingSilently && !state.selectingId
    const active = state.runtimes.find((runtime) => runtime.id === state.activeId)
    const system = state.system
    get('system-os').textContent = system ? `${system.name} ${system.version}` : 'Detecting…'
    get('system-arch').textContent = system?.architecture ?? 'Detecting…'
    get('builds-system-os').textContent = system ? `${system.name} ${system.version}` : 'Detecting…'
    get('builds-system-arch').textContent = system?.architecture ?? 'Detecting…'
    get('installed-count').textContent = !loading && state.runtimes.length > 0 ? state.runtimes.length : ''
    get('available-count').textContent = !state.buildsBusy && state.buildsLoaded && state.builds.length > 0 ? state.builds.length : ''
    get('runtime-badge').textContent = loading ? 'Checking' : active ? 'Ready' : 'Setup needed'
    get('runtime-badge').className = `badge ${active && !loading ? 'success' : ''}`
    get('active-title').textContent = loading ? 'Looking for OpenSCAD…' : active ? `OpenSCAD ${active.version}` : state.message && state.message !== 'No OpenSCAD runtime found' ? 'Runtime needs attention' : 'Set up your first runtime'
    get('active-description').textContent = loading ? 'Checking this computer for an installed runtime.' : state.message && state.message !== 'No OpenSCAD runtime found' ? '' : active ? '' : 'Install a compatible build, or add a copy of OpenSCAD you already have.'
    get('active-description').hidden = !get('active-description').textContent
    get('active-path').hidden = !active
    get('active-path').textContent = active ? [active.command.executable, ...active.command.argsPrefix].join(' ') : ''
    get('overview-primary').hidden = !!active || !!state.runtimes.length
    get('overview-actions').hidden = !!active

    renderErrors(state)
    get('installed-loading').hidden = !loading || !!state.runtimes.length
    get('installed-empty').hidden = loading || !!state.runtimes.length
    get('runtimes').hidden = !state.runtimes.length
    replaceVersions(
        get('runtimes'),
        state.runtimes.map((runtime) => {
            const row = element('article', undefined, 'version-row')
            row.setAttribute('role', 'listitem')
            const content = element('div', undefined, 'version-info')
            const heading = element('div', undefined, 'version-heading')
            const source = element('span', sourceNames[runtime.source] ?? runtime.source, 'badge source-badge')
            source.title = 'How this OpenSCAD installation was discovered.'
            heading.append(element('h3', `OpenSCAD ${runtime.version}`), source)
            content.append(heading)
            const location = element('p', [runtime.command.executable, ...runtime.command.argsPrefix].join(' '), 'runtime-location path muted')
            const selected = runtime.id === state.activeId
            const switching = state.selectingId === runtime.id
            const button = element('button', switching ? 'Switching…' : selected ? 'In Use' : 'Use This Version', selected ? 'secondary' : '')
            button.dataset.action = 'select'
            button.dataset.id = runtime.id
            button.dataset.focusKey = `installed:${runtime.id}:action`
            button.disabled = selected || loading || !!state.installing || !!state.selectingId || !!state.deletingId || !!pendingLocalAction
            button.setAttribute('aria-busy', String(switching))
            button.setAttribute('aria-label', switching ? `Switching to OpenSCAD ${runtime.version}` : selected ? `OpenSCAD ${runtime.version} is currently in use` : `Use OpenSCAD ${runtime.version} at ${runtime.command.executable}`)
            const actions = element('div', undefined, 'version-actions')
            if (runtime.installPath) {
                const deleting = state.deletingId === runtime.id
                const remove = element('button', deleting ? 'Deleting…' : 'Delete', 'runtime-delete')
                remove.dataset.action = 'deleteRuntime'
                remove.dataset.id = runtime.id
                remove.dataset.focusKey = `installed:${runtime.id}:delete`
                remove.disabled = loading || !!state.installing || !!state.selectingId || !!state.deletingId || !!pendingLocalAction
                remove.setAttribute('aria-label', `Delete OpenSCAD ${runtime.version} at ${runtime.command.executable}`)
                remove.setAttribute('aria-busy', String(deleting))
                actions.append(remove)
            }
            actions.append(button)
            row.append(content, actions, location)
            return row
        }),
    )
    renderLocalActions(state, loading)
    get('refresh-builds').disabled = state.buildsBusy
    get('refresh-builds').textContent = state.buildsBusy ? (state.buildsLoaded ? 'Refreshing…' : 'Loading…') : 'Refresh'
    get('refresh-builds').setAttribute('aria-busy', String(state.buildsBusy))
    const builds = state.builds ?? []
    get('builds-loading').hidden = !state.buildsBusy || !!builds.length
    get('builds-empty').hidden = state.buildsBusy || !!state.buildsError || !!builds.length || !state.buildsLoaded
    get('builds').hidden = !builds.length
    renderRecommendedBuild(state, loading)
    replaceVersions(
        get('builds'),
        builds.map((build) => {
            const card = element('article', undefined, 'version-row')
            card.setAttribute('role', 'listitem')
            const content = element('div', undefined, 'version-info')
            const heading = element('div', undefined, 'version-heading')
            const title = element('h3', build.release.replace(/^OpenSCAD CLI\b/i, 'OpenSCAD'))
            title.title = build.tag
            heading.append(title)
            if (build.channel === 'Stable') {
                const badge = element('span', 'Stable', 'badge success')
                badge.title = 'Version name has no suffix.'
                heading.append(badge)
            }
            content.append(heading)
            const metadata = versionMetadata([['Download size', `${(build.size / 1024 / 1024).toFixed(1)} MB`]])
            const installed = state.installedBuildIds?.includes(build.id)
            const installing = state.installing?.buildId === build.id
            const button = element('button', installing ? `Installing${state.installing.percent === undefined ? '…' : ` ${state.installing.percent}%`}` : installed ? 'Reinstall' : 'Install', 'secondary')
            button.disabled = !!state.installing || loading || !!state.selectingId || !!state.deletingId || !!pendingLocalAction
            button.setAttribute('aria-busy', String(!!installing))
            button.dataset.focusKey = `available:${build.id}:action`
            button.dataset.action = 'installBuild'
            button.dataset.id = String(build.id)
            button.setAttribute('aria-label', `${installing ? 'Installing' : installed ? 'Reinstall' : 'Install'} ${build.release}`)
            if (installed) {
                button.title = 'Remove this managed version, then download and install it again.'
            }
            card.append(content, button, metadata)
            if (installing) {
                const progress = element('p', state.installing.message, 'version-progress muted small')
                progress.setAttribute('role', 'status')
                card.append(progress)
            }
            return card
        }),
    )
}

function renderRecommendedBuild(state, loading) {
    const builds = state.builds ?? []
    const build = builds.find((build) => build.channel === 'Stable') ?? builds[0]
    get('recommended-build').hidden = !build || !!state.buildsError
    get('all-versions-heading').hidden = !builds.length
    if (!build) return
    const installed = state.installedBuildIds?.includes(build.id)
    const installing = state.installing?.buildId === build.id
    get('recommended-title').textContent = build.release.replace(/^OpenSCAD CLI\b/i, 'OpenSCAD')
    get('recommended-title').title = build.tag
    const reason = build.channel === 'Stable' ? 'Latest stable version for your system.' : 'Newest available build for your system. No stable version is listed.'
    get('recommended-description').textContent = installing ? state.installing.message : `${reason}${installed ? ' Already installed.' : ''}`
    const button = get('install-recommended')
    button.textContent = installing ? `Installing${state.installing.percent === undefined ? '…' : ` ${state.installing.percent}%`}` : installed ? 'View Installed' : 'Install Recommended'
    button.disabled = !!state.installing || !!state.buildsBusy || loading || !!state.selectingId || !!state.deletingId || !!pendingLocalAction
    button.setAttribute('aria-busy', String(!!installing))
    delete button.dataset.tab
    delete button.dataset.action
    delete button.dataset.id
    if (installed && !installing) {
        button.dataset.tab = 'installed'
        button.setAttribute('aria-label', `View installed versions of OpenSCAD`)
    } else {
        button.dataset.action = 'installBuild'
        button.dataset.id = String(build.id)
        button.setAttribute('aria-label', `Install recommended version ${build.release}`)
    }
}

function renderGitHub(state) {
    const authenticated = state.mode === 'authenticated'
    const checking = state.busy || state.mode === 'checking'
    get('github-badge').textContent = checking ? (state.mode === 'checking' ? 'Checking…' : 'Authorizing…') : authenticated ? 'Authorized' : 'Anonymous'
    get('github-badge').className = `badge ${authenticated && !checking ? 'success' : ''}`
    get('github-description').textContent = checking ? (state.mode === 'checking' ? 'Checking account authorization in VS Code…' : 'Complete the sign-in and authorization prompt in VS Code.') : authenticated ? `Requests use ${state.account || 'your GitHub account'} with a higher API limit.` : 'Using anonymous requests. Authorize an account if you encounter API rate limits.'
    get('github-authorization-error').textContent = state.message ?? ''
    get('github-authorization-error').hidden = !state.message
    get('connect-github').disabled = checking || authenticated
    get('connect-github').textContent = checking && state.mode !== 'checking' ? 'Authorizing…' : authenticated ? 'Authorized through VS Code' : 'Authorize GitHub Access'
    get('connect-github').setAttribute('aria-busy', String(checking))
}

window.addEventListener('message', (event) => {
    if (event.data?.type === 'runtimeTab' && page === 'runtime') {
        selectTab(event.data.tab, true)
    }
    if (event.data?.type === 'runtimeState' && page === 'runtime') {
        render(event.data.state)
    }
    if (event.data?.type === 'githubState') {
        get('github-sign-in-hint').hidden = page === 'more' || event.data.state.mode === 'authenticated' || !event.data.state.loginSuggested
        get('github-sign-in-hint').querySelector('button').hidden = page === 'more'
        get('github-error').textContent = event.data.state.message ?? ''
        get('github-error').hidden = page === 'more' || !event.data.state.message
        if (page === 'more') {
            renderGitHub(event.data.state)
        }
    }
    if (event.data?.type === 'actionComplete' && pendingLocalAction === event.data.action) {
        pendingLocalAction = undefined
        if (runtimeState) render(runtimeState)
    }
    if (event.data?.type === 'error') {
        if (page === 'runtime') {
            const tab = actionOrigins.get(event.data.action) ?? (event.data.action === 'installBuild' || event.data.action === 'refreshBuilds' ? 'available' : 'installed')
            actionErrors[tab] = event.data.message
            actionSeverities[tab] = event.data.severity ?? 'error'
            if (runtimeState) renderErrors(runtimeState)
        } else {
            if (event.data.action === 'connectGitHub' && get('github-error').textContent.includes(event.data.message)) {
                get('action-error').hidden = true
                return
            }
            get('action-error').className = `notice ${event.data.severity === 'warning' ? 'warning' : 'error'} request-error`
            get('action-error').textContent = event.data.message
            get('action-error').hidden = false
        }
    }
})
document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : undefined
    if (!button || button.disabled) {
        return
    }
    if (button.dataset.tab) {
        selectTab(button.dataset.tab, true)
    } else if (button.dataset.action) {
        get('action-error').hidden = true
        if (page === 'runtime') {
            const tab = vscode.getState()?.runtimeTab ?? 'overview'
            actionOrigins.set(button.dataset.action, tab)
            actionErrors[tab] = ''
            if (['browse', 'installArchive'].includes(button.dataset.action)) pendingLocalAction = button.dataset.action
            if (runtimeState) render(runtimeState)
        }
        vscode.postMessage({ action: button.dataset.action, id: button.dataset.id })
    }
})
get('runtime-tabs').addEventListener('keydown', (event) => {
    const tabs = [...get('runtime-tabs').querySelectorAll('[role="tab"]')]
    const index = tabs.indexOf(document.activeElement)
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return
    }
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    selectTab(tabs[next].dataset.tab, true)
})
vscode.postMessage({ action: 'ready' })
