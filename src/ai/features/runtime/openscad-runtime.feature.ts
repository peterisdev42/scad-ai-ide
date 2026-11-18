import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.runtime.openscad-runtime',
    kind: 'skill',
    group: 'runtime',
    display: {
        order: 102,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-runtime/SKILL.md',
    },
})
