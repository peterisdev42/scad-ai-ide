import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-spatial-feedback',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 112,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-spatial-feedback/SKILL.md',
    },
})
