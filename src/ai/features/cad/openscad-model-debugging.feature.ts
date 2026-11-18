import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-model-debugging',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 107,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-model-debugging/SKILL.md',
    },
})
