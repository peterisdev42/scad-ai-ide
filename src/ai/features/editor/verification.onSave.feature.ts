import { defineSetting } from '../../contracts/Feature'

export default defineSetting({
    id: 'setting.editor.onSave',
    kind: 'setting',
    group: 'editor',
    display: {
        label: 'CAD diagnostics on save',
        summary: 'Optionally evaluate CLI diagnostics when a SCAD/CSG document is saved. Full geometry checks are explicit.',
        order: 200,
    },
    control: {
        enabledByDefault: false,
        userConfigurable: true,
        scope: 'application',
    },
    setting: {
        key: 'scad-ai-ide.verification.onSave',
        type: 'string',
        enum: ['off', 'diagnostics'],
        default: 'off',
        description: 'Optionally evaluate CLI diagnostics when a SCAD/CSG document is saved. Full geometry checks are explicit.',
        onValue: 'diagnostics',
        offValue: 'off',
    },
})
