import { defineSetting } from '../../contracts/Feature'

export default defineSetting({
    id: 'setting.editor.sourceDiagnostics',
    kind: 'setting',
    group: 'editor',
    display: {
        label: 'Customizer source diagnostics',
        summary: 'Report static Customizer source diagnostics and offer safe Quick Fixes. Files larger than 1 MiB are skipped.',
        order: 200,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    setting: {
        key: 'scad-ai-ide.customizer.sourceDiagnostics',
        type: 'boolean',
        default: true,
        description: 'Report static Customizer source diagnostics and offer safe Quick Fixes. Files larger than 1 MiB are skipped.',
    },
})
