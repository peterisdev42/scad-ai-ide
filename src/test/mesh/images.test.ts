import test from 'node:test'
import assert from 'node:assert/strict'
import { MeshImages, type RenderResult } from '../../platform/cad/MeshImages'
import type { MeshArtifacts } from '../../core/mesh/VerificationService'
import type { MeshReport } from '../../core/mesh/types'
test('inline byte budget falls back before reading image payloads and empty models do not need a renderer', async () => {
    let reads = 0
    const images = new MeshImages(
        {
            read: async () => {
                reads++
                throw new Error('Budget must be checked first')
            },
        } as unknown as MeshArtifacts,
        '/unused-test-directory',
        async () => undefined,
        async () => true,
    )
    try {
        const result = { renderStatus: 'AVAILABLE', frames: [{ artifact: { bytes: 4 * 1048576 + 1 } }] } as RenderResult
        assert.deepEqual(await images.payloads(result), [])
        assert.equal(result.deliveryReason, 'INLINE_PAYLOAD_LIMIT')
        assert.equal(reads, 0)
        const empty = await images.render({ reportId: 'empty', snapshot: { id: 'snapshot' }, facts: { rawTriangles: 0 } } as MeshReport, {})
        assert.equal(empty.renderStatus, 'SKIPPED')
        assert.equal(empty.current, true)
    } finally {
        images.dispose()
    }
})
