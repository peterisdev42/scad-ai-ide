import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-assembly-design',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 109,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-assembly-design/SKILL.md',
    },
})
