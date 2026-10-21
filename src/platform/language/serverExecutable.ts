import * as path from 'node:path'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'

export async function resolveLanguageServer(bundled: string, configured = '', searchPath = process.env.PATH ?? ''): Promise<string> {
    const executable = async (file: string) => {
        try {
            await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
            return (await stat(file)).isFile()
        } catch {
            return false
        }
    }
    if (configured) {
        if (!path.isAbsolute(configured)) {
            throw new Error('languageServer.path must be an absolute executable path.')
        }
        if (!(await executable(configured))) {
            throw new Error(`Configured OpenSCAD language server is missing or not executable: ${configured}`)
        }
        return configured
    }
    if (await executable(bundled)) {
        return bundled
    }
    const name = process.platform === 'win32' ? 'openscad-lsp.exe' : 'openscad-lsp'
    for (const directory of searchPath.split(path.delimiter)) {
        if (path.isAbsolute(directory)) {
            const candidate = path.join(directory, name)
            if (await executable(candidate)) {
                return candidate
            }
        }
    }
    throw new Error(`OpenSCAD language server not found. Expected bundled executable: ${bundled}, or ${name} on PATH. For local development run npm run prepare:lsp; for a source build run npm run build:lsp.`)
}
