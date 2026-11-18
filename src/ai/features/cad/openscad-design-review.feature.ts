import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-design-review',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 111,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-design-review/SKILL.md',
    },
})
