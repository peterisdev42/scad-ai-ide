import { Ajv } from 'ajv'
import { parseTree, getNodeValue } from 'jsonc-parser'
import { digest } from '../cad/snapshot'
import schema from '../../../resources/schemas/cad-print-profile-v1.schema.json'
import type { PrintProfile } from './types'
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema)
export function parsePrintProfile(text: string): { profile: PrintProfile; digest: string; contentHash: string } {
    if (Buffer.byteLength(text) > 65536) throw new Error('PRINT_PROFILE_BUDGET: profile exceeds 64 KiB')
    const errors: import('jsonc-parser').ParseError[] = [],
        tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false }),
        value = tree ? getNodeValue(tree) : undefined
    if (errors.length || !tree || !validate(value)) throw new Error('PRINT_PROFILE_INVALID: ' + JSON.stringify(errors.length ? errors : (validate.errors ?? [])).slice(0, 2048))
    return { profile: value as unknown as PrintProfile, digest: digest(value), contentHash: digest(text) }
}
