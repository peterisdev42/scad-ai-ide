import { parentPort } from 'node:worker_threads'
import { subjects, geometryDigest, printScreen, encodeDisplay, pickSurface } from './geometry.js'
import type { SubjectInput, PrintProfile } from './types.js'
parentPort!.once('message', (request: { operation: 'digest' | 'view' | 'print' | 'pick'; subjects: SubjectInput[]; profile?: PrintProfile; trusted?: boolean; pick?: import('./geometry.js').PickRequest; role?: 'baseline' | 'target'; origin?: [number, number, number] }) => {
    try {
        const result = request.operation === 'pick' ? pickSurface(request.subjects[0], request.pick!) : request.operation === 'print' ? printScreen(request.subjects[0], request.profile!, !!request.trusted) : request.operation === 'digest' ? subjects(request.subjects).map(geometryDigest) : encodeDisplay(subjects(request.subjects), request.role ?? 'target', request.origin)
        parentPort!.postMessage({ ok: true, result })
    } catch (e) {
        parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : 'REVIEW_WORKER_FAILED' })
    }
})
