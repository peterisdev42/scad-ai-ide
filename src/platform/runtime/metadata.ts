import { readFile } from 'node:fs/promises'
import * as path from 'node:path'

/** Prefer saved Release metadata; offline/older packages supply their own build metadata. */
export async function readRuntimeMetadata(directory: string): Promise<{ tag?: string; release?: string }> {
    const result: { tag?: string; release?: string } = {}
    for (const name of ['scad-ai-release.json', 'build-info.json']) {
        try {
            const metadata: unknown = JSON.parse(await readFile(path.join(directory, name), 'utf8'))
            if (metadata && typeof metadata === 'object') {
                if ('tag' in metadata && typeof metadata.tag === 'string' && metadata.tag.trim()) {
                    result.tag ??= metadata.tag.replace(/^openscad-(?!cli-)/, 'openscad-cli-')
                }
                if ('release' in metadata && typeof metadata.release === 'string' && metadata.release.trim()) {
                    result.release ??= metadata.release
                }
            }
        } catch {
            // Missing or damaged metadata must not prevent discovering a usable CLI.
        }
    }
    return result
}

export async function readRuntimeTag(directory: string): Promise<string | undefined> {
    return (await readRuntimeMetadata(directory)).tag
}
