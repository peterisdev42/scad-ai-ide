import { spawnSync } from 'node:child_process'
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'src/test/libraries/online.test.ts'], { env: { ...process.env, SCAD_LIBRARIES_ONLINE: '1' }, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
