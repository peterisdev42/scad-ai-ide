export class RuntimeUnavailableError extends Error {
    constructor() {
        super('OpenSCAD render failed: No OpenSCAD runtime is available.')
        this.name = 'RuntimeUnavailableError'
    }
}
