#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PreviewSync } from './preview-sync/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [command = 'status', argument, ...extra] = process.argv.slice(2)
try {
    const sync = new PreviewSync(root, { previewRoot: process.env.PREVIEW_SYNC_PREVIEW_ROOT })
    if (command === 'init') {
        if (argument) {
            throw new Error('init 不接受额外参数')
        }
        console.log(`已记录 ${await sync.initialize()} 对文件的当前差异为初始适配基线；没有复制源码。`)
    } else if (command === 'status') {
        if (argument) {
            throw new Error('status 不接受额外参数')
        }
        const { rows, watched } = await sync.changes()
        for (const row of rows) {
            console.log(`${row.previewChanged ? 'Preview' : '-'}\t${row.ideChanged ? 'IDE' : '-'}\t${row.file}`)
        }
        console.log(`${rows.length} 对文件存在待同步改动。`)
        for (const file of watched) {
            console.log(`需人工检查宿主配置（不自动同步）: ${file}`)
        }
    } else if (command === 'to-ide' || command === 'to-preview') {
        if ((argument && argument !== '--apply') || extra.length) {
            throw new Error('方向命令仅接受可选的 --apply')
        }
        const { plan, folder } = await sync.plan(command)
        for (const [index, entry] of plan.entries.entries()) {
            console.log(`${entry.conflicts.length ? 'CONFLICT' : 'MERGE'}\t${index}\t${entry.pair.preview}`)
        }
        for (const file of plan.warnings) {
            console.log(`需人工检查宿主配置（不自动同步）: ${file}`)
        }
        console.log(`${plan.entries.length} 对待同步；计划: ${path.relative(root, folder)}/plan.json`)
        if (argument === '--apply') {
            const conflicts = plan.entries.filter((entry) => entry.conflicts.length)
            if (conflicts.length) {
                throw new Error(`存在 ${conflicts.length} 对冲突，未修改任何源码。编辑计划中的合并文件并标记 resolved，再运行 npm run preview:sync -- apply ${plan.id}`)
            }
            console.log(`已应用 ${await sync.apply(plan.id)} 对文件；请检查 Git diff 并运行双方验证。`)
        } else {
            console.log(`未修改源码。应用此计划: npm run preview:sync -- apply ${plan.id}`)
        }
    } else if (command === 'ack-host') {
        if (argument) {
            throw new Error('ack-host 不接受额外参数')
        }
        console.log(`已确认人工处理 ${await sync.acknowledgeHost()} 项宿主配置变化；源码同步基线不变。`)
    } else if (command === 'apply') {
        if (!argument || extra.length) {
            throw new Error('用法: apply <计划 ID>')
        }
        console.log(`已应用 ${await sync.apply(argument)} 对文件；请检查 Git diff 并运行双方验证。`)
    } else {
        throw new Error('用法: npm run preview:sync -- status|to-ide|to-preview [--apply]；或 apply <计划 ID>。init 仅用于首次建立基线。')
    }
} catch (error) {
    console.error(`Preview sync: ${error.message}`)
    process.exitCode = 1
}
