import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-printability',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 113,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-printability/SKILL.md',
    },
})
