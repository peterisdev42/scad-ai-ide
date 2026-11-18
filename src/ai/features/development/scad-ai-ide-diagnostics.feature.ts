import { defineSkill } from '../../contracts/Feature'

export default defineSkill({
    id: 'skill.development.scad-ai-ide-diagnostics',
    kind: 'skill',
    group: 'development',
    display: {
        order: 106,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './skills/scad-ai-ide-diagnostics/SKILL.md',
    },
})
