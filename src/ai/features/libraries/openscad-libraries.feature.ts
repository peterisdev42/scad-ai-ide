import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.libraries.openscad-libraries',
    kind: 'skill',
    group: 'libraries',
    display: {
        order: 103,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-libraries/SKILL.md',
    },
})
