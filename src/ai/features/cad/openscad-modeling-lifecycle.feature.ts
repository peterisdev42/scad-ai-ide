import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-modeling-lifecycle',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 110,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-modeling-lifecycle/SKILL.md',
    },
})
