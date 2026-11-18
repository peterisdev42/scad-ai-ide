import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.customizer.openscad-customizer',
    kind: 'skill',
    group: 'customizer',
    display: {
        order: 104,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-customizer/SKILL.md',
    },
})
