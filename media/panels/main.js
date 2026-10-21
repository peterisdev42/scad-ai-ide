const vscode = acquireVsCodeApi()
const page = document.body.dataset.page
const summaries = {
    ai: 'Manage Skills, MCP, Agent Tools and AI Providers.',
    bricks: 'Manage reusable OpenSCAD bricks.',
    libraries: 'Manage OpenSCAD libraries and project dependencies.',
    runtime: 'Discover and select OpenSCAD runtimes on the extension host.',
}
document.getElementById('summary').textContent = summaries[page]
document.getElementById(page === 'runtime' ? 'runtime' : 'placeholder').hidden = false
const headings = { ai: 'AI configuration', bricks: 'Bricks', libraries: 'Libraries' }
document.getElementById('placeholder-heading').textContent = headings[page] ?? ''

function render(state) {
    const status = document.getElementById('status')
    status.textContent = state.busy ? 'Discovering OpenSCAD' : state.message || `${state.runtimes.length} runtime${state.runtimes.length === 1 ? '' : 's'} available`
    const body = document.getElementById('runtimes')
    const rows = state.runtimes.map((runtime) => {
        const row = document.createElement('tr')
        for (const value of [runtime.version, runtime.source, [runtime.command.executable, ...runtime.command.argsPrefix].join(' ')]) {
            const cell = document.createElement('td')
            cell.textContent = value
            row.append(cell)
        }
        row.children[2].className = 'path'
        const cell = document.createElement('td')
        const button = document.createElement('button')
        const active = runtime.id === state.activeId
        button.textContent = active ? 'Active' : 'Use Runtime'
        button.dataset.action = 'select'
        button.dataset.id = runtime.id
        button.disabled = active || state.busy
        cell.append(button)
        row.append(cell)
        return row
    })
    body.replaceChildren(...rows)
    for (const button of document.querySelectorAll('.toolbar button')) {
        button.disabled = state.busy && button.dataset.action !== 'diagnostics'
    }
}

window.addEventListener('message', (event) => {
    if (event.data?.type === 'runtimeState' && page === 'runtime') {
        render(event.data.state)
    }
    if (event.data?.type === 'error') {
        document.getElementById('status').textContent = event.data.message
    }
})
document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-action]') : undefined
    if (button && !button.disabled) {
        vscode.postMessage({ action: button.dataset.action, id: button.dataset.id })
    }
})
vscode.postMessage({ action: 'ready' })
