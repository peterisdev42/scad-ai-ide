import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Runtime } from '../../core/runtime/types'

type RuntimeMetadata = Pick<Runtime, 'tag' | 'release' | 'channel'>

/** Prefer saved Release metadata; offline/older packages supply their own build metadata. */
export async function readRuntimeMetadata(directory: string): Promise<RuntimeMetadata> {
    const result: RuntimeMetadata = {}
    for (const name of ['scad-ai-release.json', 'build-info.json']) {
        try {
            const metadata: unknown = JSON.parse(await readFile(path.join(directory, name), 'utf8'))
            if (metadata && typeof metadata === 'object') {
                if ('tag' in metadata && typeof metadata.tag === 'string' && metadata.tag.trim()) {
                    result.tag ??= metadata.tag
                }
                if ('release' in metadata && typeof metadata.release === 'string' && metadata.release.trim()) {
                    result.release ??= metadata.release
                }
                if ('channel' in metadata && (metadata.channel === 'Stable' || metadata.channel === 'RC' || metadata.channel === 'Test' || metadata.channel === 'Snapshot')) {
                    result.channel ??= metadata.channel
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
