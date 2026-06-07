#!/usr/bin/env node
// PR + auto-merge フローの E2E 確認用 one-shot driver。
//
// 用途: src/git.ts の commitAndPush が「daily ブランチ→PR→squash merge」
//       を実環境で正しく回せるかを 1 分以内に検証する。
//
// 実行:
//   node scripts/e2e-pr-flow.mjs
//
// 動作:
//   1. リポジトリ直下に e2e-pr-flow-marker.txt を作成 → 新フローで commit/push
//   2. 上記ファイルを削除 → 新フローでもう一度 commit/push
//   3. それぞれ daily ブランチ → PR → squash merge が回るのを確認
//
// 注意:
//   - これは「動作確認」目的の使い捨てスクリプト。本番 cron は src/index.ts
//     経由で commitAndPush を呼ぶ。
//   - assertOnExpectedBranch があるため main / cron-runner で実行すること。

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { commitAndPush } from '../dist/git.js'

// production の scripts/run.sh と同じく origin/main へ完全同期してから始める。
// driver はローカル main / cron-runner どちらからでも呼べるが、stale 状態だと
// 後段の PR がベース不一致でコンフリクトするため最初に明示的に揃える。
function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => { out += b.toString('utf8') })
    child.stderr.on('data', (b) => { err += b.toString('utf8') })
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`${cmd} ${args.join(' ')} failed: ${err.trim()}`))
      else resolve(out)
    })
  })
}
console.log('[E2E] sync to origin/main')
await exec('git', ['fetch', 'origin', 'main'])
await exec('git', ['reset', '--hard', 'origin/main'])

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const markerRel = 'e2e-pr-flow-marker.txt'
const markerAbs = path.join(repoRoot, markerRel)

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

const stamp = new Date().toISOString()

console.log(`[E2E] step 1/2: create ${markerRel}`)
await fs.writeFile(markerAbs, `E2E PR flow marker\nCreated: ${stamp}\n`)
await commitAndPush([markerRel], `test(e2e): PR flow marker create @ ${stamp}`)
if (!(await exists(markerAbs))) {
  throw new Error('post-create: marker file unexpectedly missing locally')
}
console.log(`[E2E] step 1/2: OK\n`)

console.log(`[E2E] step 2/2: delete ${markerRel}`)
await fs.unlink(markerAbs)
await commitAndPush([markerRel], `test(e2e): PR flow marker delete @ ${stamp}`)
console.log(`[E2E] step 2/2: OK\n`)

console.log('[E2E] all steps passed')
