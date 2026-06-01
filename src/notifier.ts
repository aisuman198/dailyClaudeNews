import { spawn } from 'node:child_process'
import { categorize } from './errorCategory.js'
import { config } from './config.js'
import { addIssueComment, createIssue, ensureLabelExists, findOpenIssueByTitle } from './issueClient.js'
import { redact } from './redact.js'
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
  { name: 'category:article-fetch', color: 'FBCA04', description: '記事本文の取得失敗' },
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

function readRecentLog(): string | null {
  try {
    // require dynamic so tests don't have to mock the fs path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const home = process.env.HOME ?? ''
    if (!home) return null
    const logPath = path.join(home, 'Library/Logs/dailyClaudeNews/run.log')
    if (!fs.existsSync(logPath)) return null
    const content = fs.readFileSync(logPath, 'utf8')
    const lines = content.trim().split('\n')
    // run.log にはフルパス・ユーザー名が混ざりうる。ここで第一防御線として redact する。
    // (issue/comment 経由でも redact されるが、二重防御で確実に落とす。)
    return redact(lines.slice(-30).join('\n'))
  } catch {
    return null
  }
}

function detailsBlock(summary: string, content: string): string {
  return [
    `<details>`,
    `<summary>${summary}</summary>`,
    ``,
    '```',
    content,
    '```',
    ``,
    `</details>`,
  ].join('\n')
}

function buildIssueBody(ctx: { date: string; phase: Phase; error: Error; category: string }): string {
  const recentLog = readRecentLog()
  const blocks: string[] = [
    `## 概要`,
    `- **失敗フェーズ**: \`${ctx.phase}\``,
    `- **カテゴリ**: \`${ctx.category}\``,
    `- **初回発生日**: ${ctx.date}`,
    `- **エラーメッセージ**:`,
    '```',
    ctx.error.message,
    '```',
    '',
    detailsBlock('スタックトレース', ctx.error.stack ?? '(stack なし)'),
    '',
  ]
  if (recentLog) {
    blocks.push(detailsBlock(`直近のログ (run.log 末尾 30 行)`, recentLog), '')
  }
  blocks.push(`<sub>自動起票 by dailyClaudeNews notifier</sub>`)
  return blocks.join('\n')
}

function buildRecurrenceComment(ctx: { date: string; phase: Phase; error: Error }): string {
  const recentLog = readRecentLog()
  const blocks: string[] = [
    `### 再発: ${ctx.date}`,
    `- **フェーズ**: \`${ctx.phase}\``,
    `- **エラーメッセージ**:`,
    '```',
    ctx.error.message.slice(0, 500),
    '```',
    '',
    detailsBlock('スタックトレース', ctx.error.stack ?? '(stack なし)'),
    '',
  ]
  if (recentLog) {
    blocks.push(detailsBlock(`直近のログ (run.log 末尾 30 行)`, recentLog), '')
  }
  blocks.push(`<sub>自動コメント by dailyClaudeNews notifier</sub>`)
  return blocks.join('\n')
}

async function postOrUpdateIssue(
  cat: ReturnType<typeof categorize>,
  ctx: { date: string; phase: Phase; error: Error },
): Promise<{ action: 'created' | 'commented' | 'skipped'; issueNumber?: number; reason?: string }> {
  if (!config.errorIssueRepo) {
    return { action: 'skipped', reason: 'errorIssueRepo が未設定' }
  }

  // ラベル整備は失敗しても致命ではない
  try {
    await ensureLabels()
  } catch (err) {
    console.error(redact(`[notifier] ensureLabels 失敗（続行）: ${(err as Error).message}`))
  }

  // 既存 issue 検索
  let existing
  try {
    existing = await findOpenIssueByTitle(config.errorIssueRepo, cat.title)
  } catch (err) {
    console.error(redact(`[notifier] findOpenIssueByTitle 失敗: ${(err as Error).message}`))
    // 検索失敗時は安全側に倒して新規起票を試みる
    existing = null
  }

  if (existing) {
    try {
      await addIssueComment(
        config.errorIssueRepo,
        existing.number,
        buildRecurrenceComment(ctx),
      )
      return { action: 'commented', issueNumber: existing.number }
    } catch (err) {
      console.error(redact(`[notifier] addIssueComment 失敗 (#${existing.number}): ${(err as Error).message}`))
      return { action: 'skipped', reason: `comment failed: ${(err as Error).message}` }
    }
  }

  try {
    await createIssue(
      config.errorIssueRepo,
      cat.title,
      buildIssueBody({ ...ctx, category: cat.category }),
      cat.labels,
    )
    return { action: 'created' }
  } catch (err) {
    console.error(redact(`[notifier] createIssue 失敗: ${(err as Error).message}`))
    return { action: 'skipped', reason: `create failed: ${(err as Error).message}` }
  }
}

export const __test__ = {
  buildIssueBody,
  buildRecurrenceComment,
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

  // 常にログ（verbose に依存しない）。失敗時は理由も併記
  const issueRef = result.issueNumber ? ` #${result.issueNumber}` : ''
  const reason = result.reason ? ` (${result.reason})` : ''
  console.log(redact(`[notifier] issue ${result.action}${issueRef} (category: ${cat.category})${reason}`))
}
