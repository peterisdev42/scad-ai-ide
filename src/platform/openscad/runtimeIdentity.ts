import { open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { LaunchCommand } from '../../core/runtime/types'
import { digest } from '../../core/cad/snapshot'

/** Include the real binary behind our relocatable launcher; never evaluate a shell script. */
export async function runtimeExecutableFiles(command: LaunchCommand) {
    const executable = await realpath(command.executable)
    const files = [executable]
    const handle = await open(executable, 'r')
    let header: string
    try {
        const bytes = Buffer.alloc(65536)
        const read = await handle.read(bytes, 0, bytes.length, 0)
        header = bytes.subarray(0, read.bytesRead).toString('utf8')
    } finally {
        await handle.close()
    }
    let complete = !header.startsWith('#!')
    if (!complete) {
        const target = /exec\s+"\$base\/([A-Za-z0-9_./-]+)"\s+"\$@"/.exec(header)?.[1]
        if (header.includes('base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)') && target && !target.split('/').includes('..')) {
            files.push(await realpath(join(dirname(dirname(executable)), target)))
            complete = true
        }
    }
    for (const argument of command.argsPrefix)
        if (isAbsolute(argument) && /\.(?:m?js|cjs|py|sh)$/i.test(argument)) {
            files.push(await realpath(argument))
            complete = false
        }
    if (/^(?:flatpak|docker|podman|snap)(?:\.exe)?$/i.test(basename(executable))) complete = false
    const stamps = await Promise.all(
        [...new Set(files)].map(async (file) => {
            const info = await stat(file, { bigint: true })
            return [file, `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`]
        }),
    )
    return { files: stamps.map(([file]) => file), complete, key: digest({ command, stamps }) }
}
