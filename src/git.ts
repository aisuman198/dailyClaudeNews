import { spawn } from 'node:child_process'
import { PROJECT_ROOT } from './config.js'
import { redact } from './redact.js'

function git(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`))
      else resolve(stdout)
    })
  })
}

// 想定外のブランチで自動ジョブが走ると、生成物 (docs/daily/*.md) が
// feature ブランチに乗ったまま `git push origin main` が no-op で成功して
// 「push 完了」とログだけ出る無音事故が起きうる (2026-06-05 に発生)。
// commit する前にカレントブランチを検査し、main 以外なら例外で早期失敗させる。
// 失敗時は notifier が issue を起票するため、翌朝までに必ず気付ける。
export const EXPECTED_BRANCH = 'main'

async function assertOnExpectedBranch(): Promise<void> {
  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (current !== EXPECTED_BRANCH) {
    throw new Error(
      `commitAndPush: 期待するブランチは '${EXPECTED_BRANCH}' ですが ` +
        `'${current}' で実行されています。commit と push を中断しました。` +
        `手動で 'git checkout ${EXPECTED_BRANCH}' に戻してから再実行してください。`,
    )
  }
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

  try {
    await git(['push', 'origin', 'main'])
  } catch (err) {
    console.warn(redact(`push 失敗、pull --rebase してリトライ: ${(err as Error).message}`))
    // commit 後に push が失敗する典型は「remote が進んでいる」ケース。
    // working tree に dirty / untracked が残っている（state/seen.json 等）と
    // `git pull --rebase` が "cannot pull with rebase: You have unstaged changes" で
    // 落ちるので、rebase の間だけ stash で退避し終わったら戻す。
    await withWorkingTreeStashed(async () => {
      await git(['pull', '--rebase', 'origin', 'main'])
    })
    await git(['push', 'origin', 'main'])
  }
}

// 作業中の変更（追跡 / 未追跡 / index）を一時退避して fn を実行し、戻す。
// stash された場合のみ pop する（何もなければスキップ）。pop に失敗した場合は
// stash が残るので警告ログだけ出して呼び出し元には失敗を投げない（push 完了を優先）。
async function withWorkingTreeStashed<T>(fn: () => Promise<T>): Promise<T> {
  const stamp = `dcn-self-heal-${Date.now()}`
  const out = await git(['stash', 'push', '-u', '-m', stamp])
  const stashed = !out.includes('No local changes to save')
  try {
    return await fn()
  } finally {
    if (stashed) {
      try {
        await git(['stash', 'pop'])
      } catch (popErr) {
        console.error(
          redact(`[git] stash pop 失敗（stash は残置）: ${(popErr as Error).message}`),
        )
      }
    }
  }
}
