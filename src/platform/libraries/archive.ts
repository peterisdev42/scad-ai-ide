import * as yauzl from 'yauzl'
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { crc32 } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import * as path from 'node:path'
import { safePart } from '../../core/libraries/validation'
/** Reject links, special files, ambiguous names, collisions and decompression bombs before publishing. */
export async function extractLibraryArchive(archive: string, directory: string, signal?: AbortSignal) {
    await mkdir(directory, { recursive: true })
    await new Promise<void>((resolve, reject) => {
        yauzl.open(archive, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
            if (error || !zip) {
                reject(error ?? new Error('Invalid ZIP.'))
                return
            }
            let total = 0
            let count = 0
            const names = new Map<string, { spelling: string; directory: boolean; explicit: boolean }>()
            const fail = (e: unknown) => {
                zip.close()
                reject(e)
            }
            zip.on('error', fail)
            zip.on('end', resolve)
            zip.on('entry', (entry: yauzl.Entry) => {
                void (async () => {
                    signal?.throwIfAborted()
                    const isDirectory = entry.fileName.endsWith('/')
                    const parts = entry.fileName.replace(/\/$/, '').split('/')
                    parts.forEach(safePart)
                    const mode = (entry.externalFileAttributes >>> 16) & 0o170000
                    if (mode && mode !== 0o100000 && mode !== 0o040000) throw new Error('Archive links and special files are prohibited.')
                    total += entry.uncompressedSize
                    count++
                    if (count > 100000 || total > 512 * 1048576 || entry.uncompressedSize > 128 * 1048576 || (entry.uncompressedSize > 1048576 && entry.uncompressedSize > Math.max(1, entry.compressedSize) * 1000)) throw new Error('Library archive exceeds extraction limits.')
                    for (let i = 1; i <= parts.length; i++) {
                        const spelling = parts.slice(0, i).join('/')
                        const key = spelling.normalize('NFC').toLowerCase()
                        const directoryEntry = i < parts.length || isDirectory
                        const previous = names.get(key)
                        const explicit = i === parts.length
                        if (previous && (previous.spelling !== spelling || !previous.directory || !directoryEntry || (previous.explicit && explicit))) throw new Error('Archive contains colliding paths.')
                        names.set(key, { spelling, directory: directoryEntry, explicit: explicit || !!previous?.explicit })
                    }
                    const target = path.join(directory, ...parts)
                    if (isDirectory) await mkdir(target, { recursive: true })
                    else {
                        await mkdir(path.dirname(target), { recursive: true })
                        const stream = await new Promise<import('node:stream').Readable>((resolve, reject) => zip.openReadStream(entry, (e, s) => (e || !s ? reject(e ?? new Error('Invalid ZIP entry.')) : resolve(s))))
                        let crc = 0
                        const checksum = new Transform({
                            transform(chunk, _encoding, callback) {
                                crc = crc32(chunk, crc)
                                callback(null, chunk)
                            },
                        })
                        await pipeline(stream, checksum, createWriteStream(target, { flags: 'wx' }), { signal })
                        if (crc >>> 0 !== entry.crc32 >>> 0) throw new Error('Library ZIP entry failed CRC verification.')
                    }
                    zip.readEntry()
                })().catch(fail)
            })
            zip.readEntry()
        })
    })
}
