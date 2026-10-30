import { numericStep } from '../../src/core/customizer/CustomizerParser'
import { attachCustomizerScrollbar } from './scrollbar.js'

;(() => {
    const vscode = acquireVsCodeApi()
    const tree = document.getElementById('tree')
    const presetControls = document.getElementById('panel-controls')
    const presetHeader = document.querySelector('.preset-header')
    const presetFile = document.getElementById('preset-file')
    const presetMenu = document.getElementById('preset-menu')
    const moreButton = document.getElementById('preset-more')
    const tooltip = document.getElementById('tooltip')
    const scrollbar = attachCustomizerScrollbar(document.getElementById('scroll-host'), document.querySelector('main'), document.getElementById('scroll-content'))
    window.addEventListener('pagehide', () => scrollbar.dispose(), { once: true })
    const saved = vscode.getState() || {}
    const collapsed = new Set(saved.collapsed || [])
    const rows = new Map()
    const groupToggles = new Map()
    const allGroupsCollapsed = () => groupToggles.size > 0 && [...groupToggles.keys()].every((key) => collapsed.has(key))
    const updateGroupAction = () => send('groups', undefined, { hasGroups: groupToggles.size > 0, allCollapsed: allGroupsCollapsed() })
    let state = { parameters: [] }
    let signature = ''
    let hoverTimer
    let selected

    const element = (tag, className, text) => {
        const node = document.createElement(tag)
        if (className) node.className = className
        if (text !== undefined) node.textContent = text
        return node
    }
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const send = (type, name, value, phase) => vscode.postMessage({ type, target: state.target, revision: state.revision, name, value, phase })
    const clearTooltip = () => {
        clearTimeout(hoverTimer)
        tooltip.hidden = true
    }
    const showTooltip = (row, help = row.dataset.help) => {
        clearTooltip()
        if (!help) return
        hoverTimer = setTimeout(() => {
            if (!row.isConnected) return
            tooltip.textContent = help
            tooltip.hidden = false
            const rect = row.getBoundingClientRect()
            tooltip.style.left = '8px'
            tooltip.style.top = '0px'
            const height = tooltip.getBoundingClientRect().height
            tooltip.style.top = `${Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - height - 4))}px`
        }, 450)
    }
    // Disabled native buttons do not consistently show their title in a webview.
    // A wrapper supplies the same hover label for enabled and disabled actions.
    document.querySelectorAll('.toolbar-button, .preset-menu-item').forEach((button) => {
        const wrapper = element('span', 'toolbar-action')
        wrapper.dataset.help = button.title
        button.before(wrapper)
        wrapper.append(button)
        wrapper.addEventListener('mouseenter', () => showTooltip(wrapper))
        wrapper.addEventListener('mouseleave', clearTooltip)
        button.addEventListener('focus', () => showTooltip(wrapper))
        button.addEventListener('blur', clearTooltip)
        button.addEventListener('click', clearTooltip)
    })
    for (const id of ['preset-file', 'preset-select']) {
        const anchor = document.getElementById(id)
        anchor.addEventListener('mouseenter', () => showTooltip(anchor, anchor.dataset.help ?? anchor.title))
        anchor.addEventListener('mouseleave', clearTooltip)
        anchor.addEventListener('focus', () => showTooltip(anchor, anchor.dataset.help ?? anchor.title))
        anchor.addEventListener('blur', clearTooltip)
    }
    const chooseRow = (row) => {
        selected?.classList.remove('selected')
        selected?.closest('[role="treeitem"]')?.setAttribute('aria-selected', 'false')
        selected = row
        row.classList.add('selected')
        row.closest('[role="treeitem"]')?.setAttribute('aria-selected', 'true')
    }
    const setError = (record, message = '') => {
        record.error.textContent = message
        record.error.hidden = !message
        record.inputs.forEach((input) => input.setAttribute('aria-invalid', String(!!message)))
        if (message) document.getElementById('status').textContent = `${record.parameter.name}: ${message}`
    }
    const commit = (record, keepEditing = false) => {
        const p = record.parameter
        let value
        if (p.choices) value = p.choices[Number(record.inputs[0].value)]?.value
        else if (typeof p.defaultValue === 'boolean') value = record.inputs[0].checked
        else if (Array.isArray(p.defaultValue)) value = record.inputs.map((input) => (input.value.trim() ? Number(input.value) : NaN))
        else if (typeof p.defaultValue === 'number') value = record.inputs[0].value.trim() ? Number(record.inputs[0].value) : NaN
        else value = record.inputs[0].value
        const numbers = Array.isArray(value) ? value : typeof value === 'number' ? [value] : []
        if (numbers.some((number) => !Number.isFinite(number))) return setError(record, 'Enter a finite number')
        if (p.range) {
            if (numbers.some((number) => number < p.range.min || number > p.range.max)) return setError(record, `Enter a value between ${p.range.min} and ${p.range.max}`)
            const step = p.range.step
            if (step && numbers.some((number) => Math.abs((number - p.range.min) / step - Math.round((number - p.range.min) / step)) > 1e-7)) return setError(record, `Use steps of ${step} from ${p.range.min}`)
        }
        setError(record)
        if (!keepEditing)
            record.inputs.forEach((input) => {
                delete input.dataset.editing
            })
        send('set', p.name, value, keepEditing ? 'input' : 'commit')
    }
    const numericInput = (p, value, index) => {
        const input = element('input')
        input.type = 'number'
        input.value = String(value)
        input.step = String(numericStep(p))
        // No artificial bounds on an unannotated spinbox.
        if (p.range) {
            input.min = String(p.range.min)
            input.max = String(p.range.max)
        }
        input.setAttribute('aria-label', index === undefined ? p.name : `${p.name} ${['X', 'Y', 'Z', 'W'][index]}`)
        return input
    }
    const createParameter = (p, parent, level) => {
        const item = element('div')
        item.setAttribute('role', 'none')
        const row = element('div', 'tree-row parameter-row')
        row.setAttribute('role', 'treeitem')
        row.setAttribute('aria-level', String(level))
        row.setAttribute('aria-label', p.name)
        row.tabIndex = -1
        row.dataset.name = p.name
        const label = element('label', 'parameter-label', p.name)
        const control = element('div', 'control')
        const reset = element('button', 'icon-button reset', '↺')
        reset.title = `Reset ${p.name}`
        reset.setAttribute('aria-label', reset.title)
        const error = element('p', 'error')
        error.hidden = true
        const record = { parameter: p, row, inputs: [], reset, error }
        const id = `parameter-${rows.size}`
        const help = [p.description, p.range ? `Range: ${p.range.min}–${p.range.max}; step: ${numericStep(p)}` : p.step ? `Step: ${p.step}` : '', p.maxLength !== undefined ? `Maximum length: ${p.maxLength}` : '', `Default: ${Array.isArray(p.defaultValue) ? p.defaultValue.join(', ') : p.defaultValue}`].filter(Boolean).join('\n\n')
        row.dataset.help = help
        const accessibleHelp = element('span', 'sr-only', help)
        accessibleHelp.id = `${id}-help`
        error.id = `${id}-error`
        if (p.choices) {
            const select = element('select')
            for (const [index, choice] of p.choices.entries()) {
                const option = element('option', '', choice.label)
                option.value = String(index)
                select.append(option)
            }
            record.inputs.push(select)
        } else if (typeof p.defaultValue === 'boolean') {
            const input = element('input')
            input.type = 'checkbox'
            record.inputs.push(input)
        } else if (Array.isArray(p.defaultValue)) {
            control.classList.add('vector')
            p.defaultValue.forEach((value, index) => record.inputs.push(numericInput(p, value, index)))
        } else if (typeof p.defaultValue === 'number') {
            const input = numericInput(p, p.value)
            if (p.range) {
                input.type = 'range'
                // Decimal ranges should remain usable when no step was supplied.
                input.step = String(numericStep(p))
                input.value = String(p.value)
            }
            record.inputs.push(input)
        } else {
            const input = element('input')
            input.type = 'text'
            if (p.maxLength !== undefined) input.maxLength = p.maxLength
            record.inputs.push(input)
        }
        record.inputs.forEach((input, index) => {
            input.id = `${id}-${index}`
            if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', p.name)
            input.setAttribute('aria-describedby', `${accessibleHelp.id} ${error.id}`)
            input.addEventListener('input', () => {
                input.dataset.editing = 'true'
                if (input.type === 'range' && state.continuousPreview) commit(record, true)
            })
            input.addEventListener('change', () => commit(record))
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && input.type !== 'checkbox') {
                    event.preventDefault()
                    commit(record)
                }
                if (event.key === 'Escape') {
                    delete input.dataset.editing
                    setError(record)
                    updateValue(record, true)
                    input.blur()
                    row.focus()
                }
            })
            if (Array.isArray(p.defaultValue)) {
                const component = element('label', 'vector-component')
                component.append(element('span', 'vector-axis', ['X', 'Y', 'Z', 'W'][index]), input)
                control.append(component)
            } else control.append(input)
        })
        label.htmlFor = record.inputs[0].id
        reset.addEventListener('click', () => {
            record.inputs.forEach((input) => {
                delete input.dataset.editing
            })
            setError(record)
            send('reset', p.name)
        })
        row.addEventListener('mouseenter', () => showTooltip(row))
        row.addEventListener('mouseleave', clearTooltip)
        row.addEventListener('focusin', () => {
            chooseRow(row)
            showTooltip(row)
        })
        row.addEventListener('focusout', clearTooltip)
        row.addEventListener('click', () => chooseRow(row))
        // Keep reset beside the label so its hidden slot does not widen the right inset.
        row.append(label, reset, control, accessibleHelp)
        item.append(row, error)
        parent.append(item)
        rows.set(p.name, record)
        updateValue(record, true)
    }
    const updateValue = (record, force = false) => {
        const p = record.parameter
        record.inputs.forEach((input, index) => {
            if (!force && input.dataset.editing) return
            if (p.choices) input.value = String(p.choices.findIndex((choice) => equal(choice.value, p.value)))
            else if (input.type === 'checkbox') input.checked = p.value
            else input.value = String(Array.isArray(p.value) ? p.value[index] : p.value)
        })
        const modified = !equal(p.value, p.defaultValue)
        record.row.classList.toggle('modified', modified)
        record.reset.disabled = !modified
    }
    const createGroup = (name, key, kind = 'parameters') => {
        const section = element('div')
        section.setAttribute('role', 'treeitem')
        section.dataset.groupKind = kind
        section.setAttribute('aria-level', '1')
        section.setAttribute('aria-label', name)
        section.setAttribute('aria-expanded', String(!collapsed.has(key)))
        const row = element('div', 'tree-row group-row')
        row.tabIndex = -1
        row.append(element('span', 'twistie'), element('span', 'group-label', name))
        const children = element('div', 'children')
        children.setAttribute('role', 'group')
        children.hidden = collapsed.has(key)
        const toggle = (open = children.hidden) => {
            children.hidden = !open
            section.setAttribute('aria-expanded', String(open))
            if (open) collapsed.delete(key)
            else collapsed.add(key)
            vscode.setState({ ...vscode.getState(), collapsed: [...collapsed] })
            updateTabStops()
            updateGroupAction()
            clearTooltip()
        }
        groupToggles.set(key, toggle)
        row.addEventListener('focus', () => chooseRow(row))
        row.addEventListener('click', () => {
            chooseRow(row)
            toggle()
            row.focus()
        })
        row.addEventListener('keydown', (event) => {
            if (event.target !== row) return
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (event.key === 'ArrowRight' && !children.hidden) children.querySelector('.tree-row, input, select, button:not(:disabled)')?.focus()
                else toggle(event.key === 'ArrowRight' ? true : event.key === 'ArrowLeft' ? false : children.hidden)
            }
        })
        section.append(row, children)
        tree.append(section)
        return children
    }
    const render = (next) => {
        const nextSignature = JSON.stringify([next.target, next.parameters.map(({ value, ...parameter }) => parameter)])
        if (state.target !== next.target) scrollbar.resetPosition()
        state = next
        scrollbar.updateSettings(next.scrollSettings)
        document.getElementById('panel-controls').hidden = !state.target || !state.parameters.length
        const presets = next.presets ?? { names: [], active: '' }
        const presetSelect = document.getElementById('preset-select')
        const options = [element('option', '', 'Design default')]
        options[0].value = ''
        presets.names.forEach((name, index) => {
            const option = element('option', '', name + (presets.active === name && presets.modified ? ' · Unsaved' : ''))
            option.value = String(index)
            options.push(option)
        })
        if (!presets.active && next.parameters.some((parameter) => !equal(parameter.value, parameter.defaultValue))) {
            const option = element('option', '', 'Custom values')
            option.value = 'custom'
            option.disabled = true
            options.push(option)
        }
        presetSelect.replaceChildren(...options)
        presetSelect.value = presets.active ? String(presets.names.indexOf(presets.active)) : options.at(-1).value === 'custom' ? 'custom' : ''
        document.getElementById('preset-save').disabled = !presets.active
        document.getElementById('preset-delete').disabled = !presets.active
        presetFile.textContent = presets.filename ?? ''
        presetFile.hidden = !presets.path
        const separator = tree.querySelector('.preset-separator')
        if (separator) separator.hidden = !presets.path
        presetFile.dataset.help = presets.path ? `Preset file: ${presets.path}${presets.exists ? '' : '\nFile no longer exists.'}` : ''
        presetFile.title = presetFile.dataset.help
        const descriptions = {
            new: 'New preset — save current model values with a new name.',
            save: presets.active ? `Save preset “${presets.active}” — overwrite it with current model values.` : 'Save preset — select a named preset first, or use New preset.',
            delete: presets.active ? `Delete preset “${presets.active}” — keep current model values.` : 'Delete preset — select a named preset first.',
            import: 'Import presets — open any OpenSCAD parameter JSON file, then choose a preset below.',
            export: 'Export presets — save a copy of all saved presets. If none exist, export current model values.',
        }
        for (const [action, description] of Object.entries(descriptions)) {
            const button = document.getElementById(`preset-${action}`)
            button.title = description
            button.parentElement.dataset.help = description
        }
        const panelError = document.getElementById('panel-error')
        panelError.textContent = presets.error ?? ''
        panelError.hidden = !presets.error
        document.getElementById('empty').hidden = !!state.parameters.length
        document.getElementById('empty').textContent = state.target ? 'No customizable parameters. Define literal values before the first code block.' : 'Open an OpenSCAD file to customize its parameters.'
        if (signature === nextSignature) {
            next.parameters.forEach((p) => {
                const record = rows.get(p.name)
                record.parameter = p
                if (!record.inputs.some((input) => input.dataset.editing)) setError(record)
                updateValue(record)
            })
            return
        }
        signature = nextSignature
        clearTooltip()
        closePresetMenu(false)
        const activeName = document.activeElement?.closest('[data-name]')?.dataset.name
        rows.clear()
        groupToggles.clear()
        tree.replaceChildren()
        selected = undefined
        if (state.parameters.length) {
            const children = createGroup('Presets', JSON.stringify([state.target, 'presets', null]), 'presets')
            const heading = children.previousElementSibling
            heading.classList.add('preset-group-row')
            const separator = element('span', 'preset-separator', '·')
            separator.hidden = !presets.path
            heading.append(separator, presetHeader)
            children.append(presetControls)
        } else {
            presetControls.prepend(presetHeader)
            tree.before(presetControls)
        }
        const groups = new Map()
        for (const p of state.parameters) {
            // All sections are visible together, so Global parameters stay at the root.
            if (p.group === 'Global') {
                createParameter(p, tree, 1)
                continue
            }
            const name = p.group || 'Parameters'
            let children = groups.get(name)
            if (!children) {
                const key = JSON.stringify([state.target, name])
                children = createGroup(name, key)
                groups.set(name, children)
            }
            createParameter(p, children, 2)
        }
        updateTabStops()
        updateGroupAction()
        if (activeName && rows.has(activeName)) rows.get(activeName).inputs[0].focus()
    }
    const visibleRows = () => [...tree.querySelectorAll('.tree-row')].filter((row) => !row.closest('[hidden]'))
    const updateTabStops = () =>
        visibleRows().forEach((row, index) => {
            row.tabIndex = index === 0 ? 0 : -1
        })
    tree.addEventListener('keydown', (event) => {
        if (!event.target.classList.contains('tree-row')) return
        const items = visibleRows()
        const index = items.indexOf(event.target)
        let target
        if (event.key === 'ArrowDown') target = items[Math.min(index + 1, items.length - 1)]
        if (event.key === 'ArrowUp') target = items[Math.max(index - 1, 0)]
        if (event.key === 'Home') target = items[0]
        if (event.key === 'End') target = items.at(-1)
        if (event.key === 'ArrowLeft' && event.target.classList.contains('parameter-row')) target = event.target.closest('.children')?.previousElementSibling
        if (event.key === 'ArrowRight' && event.target.classList.contains('parameter-row')) target = event.target.querySelector('input, select')
        if (target) {
            event.preventDefault()
            target.focus()
        }
    })
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') clearTooltip()
    })
    document.addEventListener('scroll', clearTooltip, true)
    window.addEventListener('resize', clearTooltip)
    const setAllGroups = (open) => {
        groupToggles.forEach((toggle) => toggle(open))
        scrollbar.resetPosition()
    }
    const resetAll = () => {
        rows.forEach((record) => {
            record.inputs.forEach((input) => {
                delete input.dataset.editing
            })
            setError(record)
        })
        send('reset')
    }
    const discardEditing = () => rows.forEach((record) => record.inputs.forEach((input) => delete input.dataset.editing))
    const presetAction = (action, name) => {
        discardEditing()
        closePresetMenu()
        vscode.postMessage({ type: 'preset', action, name, target: state.target, revision: state.revision })
    }
    const closePresetMenu = (restoreFocus = true) => {
        const wasOpen = !presetMenu.hidden
        presetMenu.hidden = true
        moreButton.setAttribute('aria-expanded', 'false')
        if (wasOpen && restoreFocus) moreButton.focus()
    }
    const openPresetMenu = () => {
        clearTooltip()
        presetMenu.hidden = false
        moreButton.setAttribute('aria-expanded', 'true')
        const anchor = moreButton.getBoundingClientRect()
        const menu = presetMenu.getBoundingClientRect()
        presetMenu.style.left = `${Math.max(4, Math.min(anchor.right - menu.width, innerWidth - menu.width - 4))}px`
        presetMenu.style.top = `${Math.max(4, Math.min(anchor.bottom + 2, innerHeight - menu.height - 4))}px`
        presetMenu.querySelector('button:not(:disabled)')?.focus()
    }
    document.querySelector('.preset-actions').addEventListener('click', (event) => event.stopPropagation())
    moreButton.addEventListener('click', () => (presetMenu.hidden ? openPresetMenu() : closePresetMenu()))
    moreButton.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            openPresetMenu()
        }
    })
    presetMenu.addEventListener('keydown', (event) => {
        const items = [...presetMenu.querySelectorAll('button:not(:disabled)')]
        const index = items.indexOf(document.activeElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next]?.focus()
        } else if (event.key === 'Escape') {
            event.preventDefault()
            closePresetMenu()
        } else if (event.key === 'Tab') closePresetMenu(false)
    })
    document.addEventListener('pointerdown', (event) => {
        if (!presetMenu.contains(event.target) && !moreButton.contains(event.target)) closePresetMenu(false)
    })
    window.addEventListener('resize', () => closePresetMenu(false))
    document.addEventListener('scroll', () => closePresetMenu(false), true)
    document.getElementById('preset-select').addEventListener('change', (event) => {
        const value = event.target.value
        presetAction('select', value === '' ? undefined : state.presets.names[Number(value)])
    })
    for (const action of ['new', 'save', 'delete', 'import', 'export']) {
        document.getElementById(`preset-${action}`).addEventListener('click', () => presetAction(action))
    }
    window.addEventListener('message', ({ data }) => {
        if (data?.type === 'state') render(data)
        if (data?.type === 'action' && data.target === state.target && data.revision === state.revision) {
            closePresetMenu(false)
            if (data.action === 'resetAll') resetAll()
            else if (data.action === 'collapseAll') setAllGroups(false)
            else if (data.action === 'expandAll') setAllGroups(true)
        }
        if (data?.type === 'panelError' && data.target === state.target && data.revision === state.revision) {
            const error = document.getElementById('panel-error')
            error.textContent = data.message
            error.hidden = false
        }
        if (data?.type === 'scrollSettings') scrollbar.updateSettings(data.settings)
        if (data?.type === 'error' && data.target === state.target && data.revision === state.revision && rows.has(data.name)) setError(rows.get(data.name), data.message)
    })
    vscode.postMessage({ type: 'ready' })
})()
