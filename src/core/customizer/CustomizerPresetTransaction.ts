import { CapabilityError } from '../capabilities/CapabilityTypes'

export interface PresetTransactionPort {
    read(): Promise<Uint8Array | undefined>
    stage(content: Uint8Array): Promise<void>
    replace(): Promise<void>
    cleanup(): Promise<void>
}

const pending = new Map<string, Promise<void>>()
const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) => a === undefined || b === undefined ? a === b : a.length === b.length && a.every((value, index) => value === b[index])

/** Serializes extension writes and detects edits before atomic replacement.
 * A provider rename is not a cross-process CAS: another writer can still race
 * between the final read and rename. No source buffer is saved by this API.
 */
export async function commitPresetFile(key: string, port: PresetTransactionPort, expected: Uint8Array | undefined, content: Uint8Array, guard: () => void) {
    const previous = pending.get(key) ?? Promise.resolve()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => held)
    pending.set(key, tail)
    await previous
    let staged = false
    try {
        guard()
        if (!same(expected, await port.read())) throw new CapabilityError('STALE_PRESET', 'Preset file changed; read it again before writing.', true)
        guard()
        // Cleanup also runs when stage writes partially and then rejects.
        staged = true
        await port.stage(content)
        guard()
        if (!same(expected, await port.read())) throw new CapabilityError('STALE_PRESET', 'Preset file changed while preparing the write.', true)
        guard()
        await port.replace()
        staged = false
    } finally {
        try { if (staged) await port.cleanup() }
        finally {
            release()
            if (pending.get(key) === tail) pending.delete(key)
        }
    }
}
