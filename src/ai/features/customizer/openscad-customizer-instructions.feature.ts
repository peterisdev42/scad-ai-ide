import { defineInstruction } from '../../contracts/Feature'

export default defineInstruction({
    id: 'instruction.customizer.openscad-customizer',
    kind: 'instruction',
    group: 'customizer',
    display: {
        order: 101,
    },
    control: {
        enabledByDefault: true,
        userConfigurable: true,
        scope: 'application',
    },
    resource: {
        path: './instructions/openscad-customizer.instructions.md',
    },
})
