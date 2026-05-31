import { spawn } from 'node:child_process'
import { categorize } from './errorCategory.js'
import { config } from './config.js'
import { addIssueComment, createIssue, ensureLabelExists, findOpenIssueByTitle } from './issueClient.js'
import type { Phase } from './types.js'

function runSilently(cmd: string, args: string[], stdin?: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', () => { clearTimeout(timer); resolve() })
    child.on('exit', () => { clearTimeout(timer); resolve() })
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function notifyMacOs(title: string, message: string): Promise<void> {
  if (!config.macosNotification) return
  const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`
  await runSilently('osascript', ['-e', script], undefined, 5_000)
}

const ISSUE_LABELS_DEF = [
  { name: 'dailyClaudeNews', color: '0E8A16', description: 'dailyClaudeNews 自動投稿' },
  { name: 'category:timeout', color: 'FBCA04', description: 'タイムアウト系の失敗' },
  { name: 'category:rate-limit', color: 'FBCA04', description: 'Max 5h 上限など' },
  { name: 'category:fetch', color: 'D93F0B', description: 'ニュース取得失敗' },
  { name: 'category:git', color: 'D93F0B', description: 'git 操作失敗' },
  { name: 'category:unknown', color: 'CCCCCC', description: '分類不能' },
]

async function ensureLabels(): Promise<void> {
  await Promise.all(
    ISSUE_LABELS_DEF.map((l) =>
      ensureLabelExists(config.errorIssueRepo, l.name, l.color, l.description),
    ),
  )
}

function buildIssueBody(ctx: { date: string; phase: Phase; error: Error; category: string }): string {
  return [
    `## 概要`,
    `- 失敗フェーズ: \`${ctx.phase}\``,
    `- カテゴリ: \`${ctx.category}\``,
    `- 初回発生日: ${ctx.date}`,
    `- エラー: ${ctx.error.message}`,
    '',
    '## スタックトレース',
    '```',
    ctx.error.stack ?? '(stack なし)',
    '```',
    '',
    `<sub>自動起票 by dailyClaudeNews notifier</sub>`,
  ].join('\n')
}

function buildRecurrenceComment(ctx: { date: string; phase: Phase; error: Error }): string {
  return [
    `### 再発: ${ctx.date}`,
    `- フェーズ: \`${ctx.phase}\``,
    `- エラー: ${ctx.error.message.slice(0, 300)}`,
    '',
    `<sub>自動コメント by dailyClaudeNews notifier</sub>`,
  ].join('\n')
}

async function postOrUpdateIssue(
  cat: ReturnType<typeof categorize>,
  ctx: { date: string; phase: Phase; error: Error },
): Promise<{ action: 'created' | 'commented' | 'skipped'; issueNumber?: number }> {
  if (!config.errorIssueRepo) return { action: 'skipped' }

  try {
    await ensureLabels()
    const existing = await findOpenIssueByTitle(config.errorIssueRepo, cat.title)
    if (existing) {
      await addIssueComment(
        config.errorIssueRepo,
        existing.number,
        buildRecurrenceComment(ctx),
      )
      return { action: 'commented', issueNumber: existing.number }
    }
    await createIssue(
      config.errorIssueRepo,
      cat.title,
      buildIssueBody({ ...ctx, category: cat.category }),
      cat.labels,
    )
    return { action: 'created' }
  } catch {
    return { action: 'skipped' }
  }
}

export async function notifyFailure(error: Error, ctx: { phase: Phase }): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const cat = categorize(error, ctx.phase)

  const [result] = await Promise.all([
    postOrUpdateIssue(cat, { date: today, phase: ctx.phase, error }),
    notifyMacOs(
      'dailyClaudeNews 失敗',
      `${cat.category} / ${ctx.phase}: ${error.message.slice(0, 120)}`,
    ),
  ])

  if (config.verbose) {
    console.log(`[notifier] issue ${result.action}${result.issueNumber ? ` #${result.issueNumber}` : ''} (category: ${cat.category})`)
  }
}
