import { spawn } from 'node:child_process'
import { PROJECT_ROOT } from './config.js'
import { redact } from './redact.js'

function exec(cmd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`${cmd} ${args.join(' ')} failed (${code}): ${stderr.trim()}`))
      else resolve(stdout)
    })
  })
}

const git = (args: string[], timeoutMs = 30_000) => exec('git', args, timeoutMs)
const gh = (args: string[], timeoutMs = 60_000) => exec('gh', args, timeoutMs)

// 想定外のブランチで自動ジョブが走ると、生成物 (docs/daily/*.md) が
// feature ブランチに乗ったまま push が silent miss する事故が起きうる
// (2026-06-05, 2026-06-06 に発生)。commit する前にカレントブランチを検査し、
// 許可リスト外なら例外で早期失敗させる。失敗時は notifier が issue を起票するため、
// 翌朝までに必ず気付ける。
//
// 許可リストには以下を含める:
//   - main          : 手動実行 / 開発時のスモークテスト用
//   - cron-runner   : cron 専用 worktree のブランチ (scripts/setup-cron-worktree.sh 参照)
export const EXPECTED_BRANCHES: readonly string[] = ['main', 'cron-runner']

async function assertOnExpectedBranch(): Promise<void> {
  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (!EXPECTED_BRANCHES.includes(current)) {
    throw new Error(
      `commitAndPush: 許可されたブランチは ${EXPECTED_BRANCHES.map((b) => `'${b}'`).join(' / ')} ですが ` +
        `'${current}' で実行されています。commit と push を中断しました。` +
        `手動で 'git checkout main' に戻してから再実行してください。`,
    )
  }
}

// main 保護下で push 経路として使う daily ブランチ名。
// 同日内の再試行では同名ブランチに force-with-lease で上書きし、
// 既存 PR があればそれを再利用する。
export function dailyBranchName(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `daily/${y}-${m}-${d}`
}

export async function commitAndPush(paths: string[], message: string): Promise<void> {
  // ブランチガード: 想定外ブランチでの誤 commit を防ぐ
  await assertOnExpectedBranch()

  for (const p of paths) {
    await git(['add', p])
  }

  const status = await git(['status', '--porcelain'])
  if (status.trim().length === 0) {
    console.log(redact('変更が無いためコミットをスキップします'))
    return
  }

  // パブリック出力 sink: redact 必須 (ルールは ~/.claude/CLAUDE.md 参照)
  const safeMessage = redact(message)
  await git(['commit', '-m', safeMessage])

  // main は ruleset で保護されている (PR 必須 / non_fast_forward 禁止) ため、
  // 直接 push せず daily/YYYY-MM-DD ブランチ経由で PR を作って squash merge する。
  //
  //   1. daily ブランチへ push (--force-with-lease で同日再試行に対応)
  //   2. open PR があれば再利用、無ければ作成
  //   3. gh pr merge --squash --delete-branch (admin merge にフォールバック)
  //
  // 同日内の典型的な再試行ケース:
  //   - launchd の再起動 / 手動 retry: 同じ daily ブランチに force-with-lease で
  //     上書きし、同じ PR を再利用する。force は cron 自身が作ったブランチへの
  //     上書きに限定されるため、ローカル知らずに他者が push していたら fail する。
  const branch = dailyBranchName()

  await git(['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`])

  const listOut = await gh([
    'pr', 'list',
    '--head', branch,
    '--base', 'main',
    '--state', 'open',
    '--json', 'number',
    '--limit', '1',
  ])
  const existing = JSON.parse(listOut.trim() || '[]') as Array<{ number: number }>
  const existingPr = existing[0]

  let prNumber: number
  if (existingPr !== undefined) {
    prNumber = existingPr.number
    console.log(redact(`既存 PR #${prNumber} を再利用 (daily ブランチに force push 済み)`))
  } else {
    const body = `${safeMessage}\n\n自動生成 PR (${branch})。main の ruleset により直接 push できないため、squash merge 用に切られた一時ブランチです。`
    const createOut = await gh([
      'pr', 'create',
      '--base', 'main',
      '--head', branch,
      '--title', safeMessage,
      '--body', body,
    ])
    const match = createOut.match(/\/pull\/(\d+)/)
    if (!match) {
      throw new Error(`PR 作成の出力から PR 番号を取得できませんでした: ${createOut.trim()}`)
    }
    prNumber = Number(match[1])
    console.log(redact(`PR #${prNumber} を作成`))
  }

  // 通常 squash merge を試し、必須 review 等で弾かれたら --admin (admin bypass) で再試行。
  // 個人 repo で viewerPermission=ADMIN を前提とする。--admin が無くても通る ruleset
  // (PR 必須・必須 review 無し) なら一度目で成功する。
  try {
    await gh(['pr', 'merge', String(prNumber), '--squash', '--delete-branch'], 180_000)
    console.log(redact(`PR #${prNumber} を squash merge`))
  } catch (err) {
    const m = (err as Error).message
    console.warn(redact(`通常 merge 失敗、--admin で再試行: ${m}`))
    await gh(['pr', 'merge', String(prNumber), '--squash', '--delete-branch', '--admin'], 180_000)
    console.log(redact(`PR #${prNumber} を admin merge`))
  }
}
