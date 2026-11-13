import { digest } from '../cad/snapshot'
/** Pair identity is report-local; stable part identity also includes canonical Manifest URI. */
export function pairId(a: string, b: string): string {
    return digest([a, b].sort())
}
