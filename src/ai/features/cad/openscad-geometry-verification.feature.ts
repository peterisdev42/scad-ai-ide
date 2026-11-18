import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.cad.openscad-geometry-verification',
    kind: 'skill',
    group: 'cad',
    display: {
        order: 108,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/openscad-geometry-verification/SKILL.md',
    },
})
