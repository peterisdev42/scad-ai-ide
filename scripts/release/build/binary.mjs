import { requireRelease } from '../common/io.mjs'

export function verifyBinary(bytes, target) {
    const size = bytes.length
    let expected = false
    if (target === 'darwin-arm64' || target === 'darwin-x64') {
        const cpu = target === 'darwin-arm64' ? 0x0100000c : 0x01000007
        expected = size >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf &&
            bytes.readUInt32LE(4) === cpu && bytes.readUInt32LE(12) === 2
    } else if (target === 'linux-x64') {
        expected = size >= 64 && bytes.readUInt32BE(0) === 0x7f454c46 && bytes[4] === 2 && bytes[5] === 1 &&
            [2, 3].includes(bytes.readUInt16LE(16)) && bytes.readUInt16LE(18) === 62
    } else if (target === 'win32-x64' && size >= 64 && bytes.readUInt16BE(0) === 0x4d5a) {
        const peOffset = bytes.readUInt32LE(60)
        expected = peOffset >= 64 && peOffset + 26 <= size && bytes.readUInt32LE(peOffset) === 0x4550 &&
            bytes.readUInt16LE(peOffset + 4) === 0x8664 && bytes.readUInt16LE(peOffset + 24) === 0x20b &&
            (bytes.readUInt16LE(peOffset + 22) & 0x2002) === 0x0002
    }
    requireRelease(expected, `Invalid executable header for ${target}`, 5)
}
