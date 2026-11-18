import { defineInstruction } from '../../contracts/Feature'

export default defineInstruction({
    id: 'instruction.discovery.openscad',
    kind: 'instruction',
    group: 'discovery',
    display: {
        order: 100,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './instructions/openscad.instructions.md',
    },
})
