import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { decodeMesh } from '../../core/mesh/decode'
import { threeMf } from './fixtures'
function change(fn: (files: Record<string, Uint8Array>) => void) {
    const files = unzipSync(threeMf())
    fn(files)
    return zipSync(files)
}
test('3MF rejects unsafe ZIP paths, XML entities, reference cycles, missing parts and invalid indices', () => {
    const variants = [
        change((f) => {
            f['../escape'] = strToU8('unsafe')
        }),
        change((f) => {
            f['Models/main.model'] = strToU8('<!DOCTYPE model [<!ENTITY file SYSTEM "file:///etc/passwd">]>' + strFromU8(f['Models/main.model']))
        }),
        change((f) => {
            f['Models/main.model'] = strToU8(strFromU8(f['Models/main.model']).replace('<item objectid="1"/>', '<item objectid="99"/>'))
        }),
        change((f) => {
            delete f['Models/main.model']
        }),
        change((f) => {
            f['Models/main.model'] = strToU8(strFromU8(f['Models/main.model']).replace('v1="0"', 'v1="999999"'))
        }),
        threeMf({ extra: '<object id="2"><components><component objectid="2"/></components></object>', build: '<item objectid="2"/>' }),
    ]
    for (const bytes of variants) assert.throws(() => decodeMesh(bytes, '3mf'))
    const damaged = threeMf()
    damaged[45] ^= 255
    assert.throws(() => decodeMesh(damaged, '3mf'))
})

test('checked-in golden meshes retain their reviewed hashes', async()=>{
    const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto')
    const manifest=JSON.parse(await readFile('src/test/mesh/golden/sha256.json','utf8'))
    for(const row of manifest.fixtures){const bytes=await readFile('src/test/mesh/golden/'+row.name);assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);assert.doesNotThrow(()=>decodeMesh(bytes,row.name.endsWith('.3mf')?'3mf':'stl'))}
})
