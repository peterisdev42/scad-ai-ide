import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.customizer.openscad-customizer-authoring',
    kind: 'skill',
    group: 'customizer',
    display: {
        order: 105,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-customizer-authoring/SKILL.md',
    },
})
